"""Optional real MCP -> BE-D04 -> PostgreSQL proof; never uses production data."""
import asyncio
import json
import os
from urllib.parse import urlparse
from uuid import uuid4

import asyncpg
import pytest
from fastapi.testclient import TestClient

from src.servers.policy_server import create_app


def test_generate_iac_real_backend(monkeypatch):
    backend = os.getenv("IAC_TEST_BACKEND_URL")
    dsn = os.getenv("TEST_DATABASE_URL")
    token = os.getenv("IAC_TEST_SERVICE_TOKEN")
    if not backend or not dsn or not token:
        pytest.skip("Disposable BE-D04 service and TEST_DATABASE_URL required")
    if not urlparse(dsn).path.startswith("/provisr_or_planning_test_"):
        pytest.fail("Use a disposable provisr_or_planning_test_* database")
    if urlparse(backend).hostname not in {"127.0.0.1", "localhost"}:
        pytest.fail("Integration backend must run on localhost")

    workspace, user, session, run, correlation, manifest_id = [uuid4() for _ in range(6)]
    manifest = {"schema_version": "1.0", "provider": "aws", "region": "us-east-1", "resources": [
        {"logical_name": "bucket", "type": "storage.aws.s3",
         "properties": {"name": "private-integration-bucket", "versioning": True}}]}

    async def seed():
        db = await asyncpg.connect(dsn)
        try:
            await db.execute("INSERT INTO provisr_identity.users(id,clerk_id,name,email) VALUES ($1,$2,'Test','test@example.invalid')", user, str(user))
            await db.execute("INSERT INTO provisr_identity.workspaces(id,name,slug,environment) VALUES ($1,'Test',$2,'dev')", workspace, str(workspace))
            await db.execute("INSERT INTO provisr_identity.memberships(workspace_id,user_id,role) VALUES ($1,$2,'engineer')", workspace, user)
            await db.execute("INSERT INTO provisr_state.chat_sessions(id,workspace_id,user_id,title) VALUES ($1,$2,$3,'Test')", session, workspace, user)
            await db.execute("""INSERT INTO provisr_state.provisioning_runs
                (id,session_id,workspace_id,requester_id,prompt,idempotency_key,correlation_id,state)
                VALUES ($1,$2,$3,$4,'Test',$5,$6,'IAC_GENERATING')""", run, session, workspace, user, str(run), correlation)
            await db.execute("INSERT INTO provisr_manifest.manifests(id,run_id,version,content) VALUES ($1,$2,1,$3::jsonb)", manifest_id, run, json.dumps(manifest))
            await db.execute("""UPDATE provisr_state.provisioning_runs SET manifest_version=1,
                manifest_validated_version=1,manifest_confirmed_version=1,manifest_confirmed_at=now() WHERE id=$1""", run)
        finally:
            await db.close()

    asyncio.run(seed())
    monkeypatch.setenv("DATABASE_URL", dsn)
    runtime = create_app(manifest_backend_url=backend, iac_service_token=token)
    body = {"manifest_id": str(manifest_id), "context": {
        "workspace_id": str(workspace), "user_id": str(user), "request_id": str(run),
        "correlation_id": str(correlation), "session_id": str(session),
        "permissions": ["iac:write"], "idempotency_key": "iac-integration-1"}}
    with TestClient(runtime) as client:
        assert client.post("/tools/generate_iac", json=body).status_code == 401
        response = client.post("/tools/generate_iac", json=body, headers={"Authorization": f"Bearer {token}"})
        assert response.status_code == 200, response.text
        artifact = response.json()
        replay = client.post("/tools/generate_iac", json=body, headers={"Authorization": f"Bearer {token}"})
        assert replay.status_code == 200 and replay.json() == artifact
        assert artifact["manifest_id"] == str(manifest_id)
        assert artifact["summary"]["resource_count"] == 1
        files = {file["path"]: file["content"] for file in artifact["terraform_files"]}
        assert 'source = "./resources"' in files["main.tf"]
        assert "private-integration-bucket" in files["terraform.tfvars"]
        assert 'bucket = var.r_bucket["bucket"]' in files["resources/storage.tf"]

    async def verify():
        db = await asyncpg.connect(dsn)
        try:
            assert await db.fetchval("SELECT count(*) FROM provisr_iac.artifacts WHERE run_id=$1", run) == 1
            assert await db.fetchval("SELECT count(*) FROM provisr_audit.audit_events WHERE resource_id=$1 AND event_type='artifact_generated'", artifact["iac_artifact_id"]) == 1
        finally:
            await db.close()

    asyncio.run(verify())
