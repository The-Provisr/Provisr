import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DbService } from "../../src/db/db.service";
import { RunsService } from "../../src/state-machine/runs.service";
import { AuditService } from "../../src/services/audit.service";
import { iacIdempotencyKey } from "../../src/services/iac-contracts";
import { iacFixture } from "../helpers/iac-fixture";

const connection = process.env.TEST_IAC_DATABASE_URL;
const dependencyMigration = process.env.TEST_IAC_DEPENDENCY_MIGRATION;
describe.skipIf(!connection)("OR-013 real PostgreSQL (MCP HTTP mocked)", () => {
  let db: DbService;
  const migrations = resolve(process.cwd(), "../backend/migrations");
  beforeAll(async () => {
    if (!new URL(connection!).pathname.startsWith("/provisr_or_planning_test_")) throw new Error("Use a disposable provisr_or_planning_test_* database");
    db = new DbService({ databaseUrl: connection });
    const files = (await readdir(migrations)).filter(file => file.endsWith(".up.sql")).sort();
    for (const file of files) {
      // Until BE-D04 lands, test against its actual migration rather than inventing its schema.
      if (file.startsWith("000023") && dependencyMigration && !files.some(name => name.startsWith("000022"))) {
        await db.query(await readFile(dependencyMigration, "utf8"));
      }
      await db.query(await readFile(resolve(migrations, file), "utf8"));
    }
    expect((await db.query(`SELECT 1 FROM information_schema.columns WHERE table_schema='provisr_iac' AND table_name='artifacts' AND column_name='generation'`)).rows).toHaveLength(1);
  }, 30000);
  afterAll(async () => { if (db) await db.onModuleDestroy(); });

  async function setup() {
    const f = iacFixture();
    const r = f.run;
    await db.query(`INSERT INTO provisr_identity.users(id,clerk_id,name,email) VALUES ($1,$2,'IaC test',$3)`, [r.requesterId,r.requesterId,`${r.requesterId}@example.invalid`]);
    await db.query(`INSERT INTO provisr_identity.workspaces(id,name,slug,environment) VALUES ($1,'IaC test',$2,'dev')`, [r.workspaceId,r.workspaceId]);
    await db.query(`INSERT INTO provisr_identity.memberships(workspace_id,user_id,role) VALUES ($1,$2,'engineer')`, [r.workspaceId,r.requesterId]);
    await db.query(`INSERT INTO provisr_state.chat_sessions(id,workspace_id,user_id,title) VALUES ($1,$2,$3,'IaC test')`, [r.sessionId,r.workspaceId,r.requesterId]);
    await db.query(`INSERT INTO provisr_state.provisioning_runs(id,session_id,workspace_id,requester_id,prompt,state,correlation_id,idempotency_key)
      VALUES ($1,$2,$3,$4,'IaC test','IAC_GENERATING',$5,$6)`, [r.id,r.sessionId,r.workspaceId,r.requesterId,r.correlationId,randomUUID()]);
    await db.query(`INSERT INTO provisr_manifest.manifests(id,run_id,version,content) VALUES ($1,$2,2,'{}')`, [f.manifestId,r.id]);
    await db.query(`UPDATE provisr_state.provisioning_runs SET manifest_version=2,manifest_validated_version=2,manifest_confirmed_version=2,manifest_confirmed_at=now() WHERE id=$1`, [r.id]);
    const persist = async () => {
      await db.query(`INSERT INTO provisr_iac.artifacts(id,run_id,type,storage_path,hash,manifest_id,idempotency_key,generation)
        VALUES ($1,$2,'terraform',$3,$4,$5,$6,$7::jsonb)`, [f.artifact.iac_artifact_id,r.id,`db://provisr_iac/artifacts/${f.artifact.iac_artifact_id}`,
        f.artifact.hash,f.manifestId,iacIdempotencyKey(r,f.manifestId),JSON.stringify(f.artifact)]);
    };
    f.fetcher.mockImplementation(async () => {
      expect((await db.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND state='idle in transaction'`)).rows).toHaveLength(0);
      await persist(); return new Response(JSON.stringify(f.artifact));
    });
    const service = new RunsService(db,new AuditService(db),f.clients);
    return { ...f, service, persist, process: () => service.processRun(r.id,r.workspaceId) };
  }

  it("rolls migration down/up before links exist and indexes generation work", async () => {
    await db.query(await readFile(resolve(migrations,"000027_iac_orchestration.down.sql"),"utf8"));
    await db.query(await readFile(resolve(migrations,"000027_iac_orchestration.up.sql"),"utf8"));
    const index = await db.query<{ indexdef: string }>(`SELECT indexdef FROM pg_indexes WHERE indexname='idx_run_planning_work'`);
    expect(index.rows[0]!.indexdef).toContain("IAC_GENERATING");
  });

  it("serializes workers, atomically persists the exact artifact link, audit and replayable SSE", async () => {
    const f = await setup();
    await Promise.all([f.process(),f.process()]);
    expect(f.fetcher).toHaveBeenCalledOnce();
    expect(await f.service.getRun(f.run.id,f.run.workspaceId)).toMatchObject({ state: "PLAN_CREATING",iacArtifactId: f.artifact.iac_artifact_id });
    const events = await db.query<{ payload: Record<string,unknown>; stream_sequence: string }>(`SELECT payload,stream_sequence FROM provisr_events.sse_events WHERE workspace_id=$1 ORDER BY stream_sequence`,[f.run.workspaceId]);
    expect(events.rows.map(e => e.payload.message).filter(Boolean)).toEqual(["Generating Terraform templates...","Validating generated output..."]);
    expect(events.rows.at(-1)!.payload).toMatchObject({ to: "PLAN_CREATING",iac_artifact_id: f.artifact.iac_artifact_id,manifest_version: 2 });
    expect((await db.query(`SELECT 1 FROM provisr_audit.audit_events WHERE resource_id=$1`,[f.run.id])).rows).toHaveLength(3);
    await expect(db.query(await readFile(resolve(migrations,"000027_iac_orchestration.down.sql"),"utf8"))).rejects.toThrow("Cannot discard");
  });

  it("keeps a generated artifact unlinked when cancellation wins the network race", async () => {
    const f = await setup();
    f.fetcher.mockImplementation(async () => {
      await f.persist();
      await f.service.cancelRun(f.run.id,f.run.workspaceId,f.run.requesterId);
      return new Response(JSON.stringify(f.artifact));
    });
    await f.process();
    expect(await f.service.getRun(f.run.id,f.run.workspaceId)).toMatchObject({ state: "CANCELLED",iacArtifactId: null });
  });

  it("replays generation after a state-version conflict without generating another artifact", async () => {
    const f = await setup();
    f.fetcher.mockImplementationOnce(async () => {
      await f.persist();
      // Simulate a concurrent committed writer while the HTTP call is in flight.
      await db.query(`UPDATE provisr_state.provisioning_runs SET state_version=state_version+1 WHERE id=$1`,[f.run.id]);
      return new Response(JSON.stringify(f.artifact));
    });
    await f.process();
    expect(await f.service.getRun(f.run.id,f.run.workspaceId)).toMatchObject({ state: "IAC_GENERATING",iacArtifactId: null });
    f.fetcher.mockResolvedValue(new Response(JSON.stringify(f.artifact)));
    await f.process();
    expect(await f.service.getRun(f.run.id,f.run.workspaceId)).toMatchObject({ state: "PLAN_CREATING",iacArtifactId: f.artifact.iac_artifact_id });
    expect((await db.query(`SELECT 1 FROM provisr_iac.artifacts WHERE run_id=$1`,[f.run.id])).rows).toHaveLength(1);
    expect(new Set(f.fetcher.mock.calls.map(([,init]) => JSON.parse(init!.body as string).context.idempotency_key)).size).toBe(1);
  });

  it("rolls back the artifact link and state if final SSE persistence fails", async () => {
    const f = await setup();
    await db.query(`CREATE FUNCTION provisr_events.reject_iac_test() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN IF NEW.payload->>'run_id'='${f.run.id}' AND NEW.payload->>'to'='PLAN_CREATING' THEN RAISE EXCEPTION 'SSE failure'; END IF; RETURN NEW; END $$;
      CREATE TRIGGER reject_iac_test BEFORE INSERT ON provisr_events.sse_events FOR EACH ROW EXECUTE FUNCTION provisr_events.reject_iac_test()`);
    try {
      await f.process();
      expect(await f.service.getRun(f.run.id,f.run.workspaceId)).toMatchObject({ state: "FAILED",iacArtifactId: null });
      const events = await db.query<{ payload: Record<string,unknown> }>(`SELECT payload FROM provisr_events.sse_events WHERE workspace_id=$1`,[f.run.workspaceId]);
      expect(events.rows.some(e => e.payload.to === "PLAN_CREATING")).toBe(false);
    } finally { await db.query("DROP TRIGGER reject_iac_test ON provisr_events.sse_events; DROP FUNCTION provisr_events.reject_iac_test()"); }
  });

  it("does not resolve a manifest from a different workspace", async () => {
    const f = await setup();
    await expect(f.service.processRun(f.run.id,randomUUID())).rejects.toThrow("Run not found");
    expect(f.fetcher).not.toHaveBeenCalled();
  });
});
