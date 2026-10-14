import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbService } from "../../src/db/db.service";
import { RunsService } from "../../src/state-machine/runs.service";
import { AuditService, serializeAuditPayload } from "../../src/services/audit.service";
import { ChatPersistenceService } from "../../src/services/chat-persistence.service";
import { ChatEventsService } from "../../src/services/chat-events.service";
import { fakeClients, manifest, policy, contextFor } from "../helpers/planning-fixture";

const connection = process.env.TEST_DATABASE_URL;
describe.skipIf(!connection)("OR-M01..012 real PostgreSQL", () => {
  let db: DbService;
  let service: RunsService;
  const workspaceId = randomUUID(), userId = randomUUID(), sessionId = randomUUID();
  beforeAll(async () => {
    // Refuse to run migrations against a normal application database.
    if (!new URL(connection!).pathname.startsWith("/provisr_or_planning_test_")) throw new Error("Use a disposable provisr_or_planning_test_* database");
    db = new DbService({ databaseUrl: connection });
    const migrations = resolve(process.cwd(), "../backend/migrations");
    const files = (await readdir(migrations)).filter(file => file.endsWith(".up.sql")).sort();
    for (const file of files) await db.query(await readFile(resolve(migrations, file), "utf8"));
    await db.query(`INSERT INTO provisr_identity.users (id, clerk_id, name, email) VALUES ($1,$2,'Test','test@example.invalid')`, [userId, userId]);
    await db.query(`INSERT INTO provisr_identity.workspaces (id,name,slug,environment) VALUES ($1,'Test',$2,'dev')`, [workspaceId,workspaceId]);
    await db.query(`INSERT INTO provisr_identity.memberships (workspace_id,user_id,role) VALUES ($1,$2,'engineer')`, [workspaceId,userId]);
    await db.query(`INSERT INTO provisr_state.chat_sessions (id,workspace_id,user_id,title) VALUES ($1,$2,$3,'Test')`, [sessionId,workspaceId,userId]);
    service = new RunsService(db);
  }, 30000);
  afterAll(async () => { if (db) await db.onModuleDestroy(); });

  it("creates a single run on concurrent idempotent requests", async () => {
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 4 }, () => service.createRun(sessionId,workspaceId,userId,"Create bucket",key)));
    expect(new Set(results.map(run => run.id)).size).toBe(1);
    expect(results[0]!.state).toBe("RECEIVED");
    await expect(service.createRun(sessionId,workspaceId,userId,"Different prompt",key)).rejects.toThrow("Idempotency key");
  });

  it("persists transitions, validates answer mappings, and resumes the same run", async () => {
    let run = await service.createRun(sessionId,workspaceId,userId,"Clarification");
    run = await service.transitionState(run.id,workspaceId,run.stateVersion,"POLICY_LOADED",userId);
    run = await service.transitionState(run.id,workspaceId,run.stateVersion,"CLOUD_CONTEXT_LOADED",userId,{ policyRequirements: policy, policyRequirementsLoadedAt: new Date() });
    await expect(service.transitionState(run.id,workspaceId,run.stateVersion,"MANIFEST_CREATING",userId)).rejects.toThrow("cloudContextLoaded");
    run = await service.transitionState(run.id,workspaceId,run.stateVersion,"MANIFEST_CREATING",userId,{ cloudContext: contextFor(run), cloudContextLoadedAt: new Date() });
    run = await service.suspendRun(run,{ question: "Region?",fields: [{ name: "region",type: "string",options: ["us-east-1"] }] });
    await expect(service.clarifyRun(run.id,workspaceId,userId,{ answers: { region: "us-east-1", unexpected: true } })).rejects.toThrow("Answers do not match");
    const resumed = await service.clarifyRun(run.id,workspaceId,userId,{ answers: { region: "us-east-1" },idempotencyKey: "clarify-once" });
    expect(resumed.id).toBe(run.id);
    expect(resumed.state).toBe("MANIFEST_CREATING");
    expect(resumed.answersHistory).toHaveLength(1);
    const replay = await service.clarifyRun(run.id,workspaceId,userId,{ answers: { region: "us-east-1" },idempotencyKey: "clarify-once" });
    expect(replay.stateVersion).toBe(resumed.stateVersion);
    await expect(service.transitionState(run.id,workspaceId,run.stateVersion,"FAILED",userId)).rejects.toThrow("State version conflict");
  });

  it("rolls back state and audit when the outbox rejects an insert", async () => {
    const run = await service.createRun(sessionId,workspaceId,userId,"Rollback");
    const before = await db.query(`SELECT count(*) AS count FROM provisr_audit.audit_events WHERE resource_id = $1`,[run.id]);
    await db.query(`CREATE FUNCTION provisr_events.test_reject_event() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.payload->>'run_id' = '${run.id}' THEN RAISE EXCEPTION 'test outbox failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_reject_event BEFORE INSERT ON provisr_events.sse_events FOR EACH ROW EXECUTE FUNCTION provisr_events.test_reject_event()`);
    try {
      await expect(service.transitionState(run.id,workspaceId,0,"POLICY_LOADED",userId)).rejects.toThrow("test outbox failure");
      expect((await service.getRun(run.id,workspaceId)).stateVersion).toBe(0);
      expect((await db.query(`SELECT count(*) AS count FROM provisr_audit.audit_events WHERE resource_id = $1`,[run.id])).rows).toEqual(before.rows);
    } finally { await db.query("DROP TRIGGER test_reject_event ON provisr_events.sse_events; DROP FUNCTION provisr_events.test_reject_event()"); }
  });

  it("stores versions and blocks IaC until the active version is confirmed", async () => {
    const created = await service.createRun(sessionId,workspaceId,userId,"Manifest");
    const c = fakeClients(created,[{ type: "manifest_draft",data: { message: "Draft",manifest } },{ type: "manifest_draft",data: { message: "Revision",manifest } }]);
    const original = c.fetcher.getMockImplementation()!;
    c.fetcher.mockImplementation(async (url, init) => {
      if (new URL(String(url)).pathname !== "/v1/manifests") return original(url,init);
      const body = JSON.parse(init!.body as string);
      // Mock the remote BE-D02 dependency with real canonical manifest storage.
      // Its authorization, validation, concurrency and audit are separately tested in Go.
      const result = await db.query<{ version: number }>(`INSERT INTO provisr_manifest.manifests (run_id,version,content,idempotency_key)
        SELECT $1,COALESCE(MAX(version),0)+1,$2::jsonb,$3 FROM provisr_manifest.manifests WHERE run_id=$1 RETURNING version`,[created.id,JSON.stringify(body.content),body.context.idempotency_key]);
      return new Response(JSON.stringify(result.rows[0]),{ status: 201 });
    });
    const planning = new RunsService(db,new AuditService(db),c.clients);
    await planning.processRun(created.id,workspaceId);
    let run = await service.getRun(created.id,workspaceId);
    expect(run).toMatchObject({ state: "MANIFEST_VALIDATING",manifestVersion: 1,manifestValidatedVersion: 1 });
    await expect(service.transitionState(run.id,workspaceId,run.stateVersion,"IAC_GENERATING",userId)).rejects.toThrow("manifestConfirmed");
    await planning.reviseRun(run.id,workspaceId,userId,"Change the bucket");
    await planning.processRun(created.id,workspaceId);
    run = await service.getRun(created.id,workspaceId);
    expect(run.manifestVersion).toBe(2);
    await expect(service.confirmRun(run.id,workspaceId,userId,{ manifestVersion: "1" })).rejects.toThrow("active validated");
    expect((await service.confirmRun(run.id,workspaceId,userId,{ manifestVersion: "2" })).state).toBe("IAC_GENERATING");
    await expect(db.query(`UPDATE provisr_manifest.manifests SET content='{}' WHERE run_id=$1`,[run.id])).rejects.toThrow("immutable");
    await expect(db.query(`DELETE FROM provisr_manifest.manifests WHERE run_id=$1`,[run.id])).rejects.toThrow("immutable");
  });

  it("expires clarification and deletes a terminal session without enum casting errors", async () => {
    const ownSession = randomUUID();
    await db.query(`INSERT INTO provisr_state.chat_sessions (id,workspace_id,user_id,title) VALUES ($1,$2,$3,'Expiry')`,[ownSession,workspaceId,userId]);
    let run = await service.createRun(ownSession,workspaceId,userId,"Expiry");
    run = await service.transitionState(run.id,workspaceId,run.stateVersion,"POLICY_LOADED",userId);
    run = await service.transitionState(run.id,workspaceId,run.stateVersion,"CLOUD_CONTEXT_LOADED",userId,{ policyRequirements: policy,policyRequirementsLoadedAt: new Date() });
    run = await service.transitionState(run.id,workspaceId,run.stateVersion,"CLARIFYING",userId,{ cloudContext: contextFor(run),cloudContextLoadedAt: new Date(),currentQuestion: { question: "Region?",fields: [{ name: "answer",type: "string" }] },clarificationExpiresAt: new Date(Date.now()-1000) });
    await service.processRun(run.id,workspaceId);
    expect((await service.getRun(run.id,workspaceId)).state).toBe("CANCELLED");
    await new ChatPersistenceService(db,new ChatEventsService(db)).deleteSession(ownSession,workspaceId,userId);
  });

  it("serializes concurrent audit appends into a verifiable global SHA-256 chain", async () => {
    const runs = await Promise.all(Array.from({ length: 8 },(_,i) => service.createRun(sessionId,workspaceId,userId,`Concurrent ${i}`)));
    await Promise.all(runs.map(run => service.transitionState(run.id,workspaceId,0,"POLICY_LOADED",userId)));
    const result = await db.query(`SELECT workspace_id,event_type,resource_id,payload,hash,previous_hash,correlation_id FROM provisr_audit.audit_events ORDER BY seq`);
    let previous = null;
    for (const row of result.rows) {
      expect(row.previous_hash).toBe(previous);
      const hash = createHash("sha256").update(`${previous ?? ""}|${row.workspace_id}|${row.event_type}|${row.resource_id}|${serializeAuditPayload(row.payload)}|${row.correlation_id}`).digest("hex");
      expect(row.hash).toBe(hash);
      previous = row.hash;
    }
  });
});
