import copy
from src.servers.manifest_creation import _canonicalize_draft
from src.servers.manifest_validation import validate_contextual_manifest
from test_manifest_validation import MANIFEST, CLOUD, POLICY, WORKSPACE

def test_projection_preserves_resource_properties():
    draft=copy.deepcopy(MANIFEST)
    draft["resources"]=[{"type":"aws_rds","name":"orders","engine":"mysql","instance_class":"db.t3.micro","allocated_storage_gb":30}]
    result=_canonicalize_draft(draft)
    assert result["resources"][0]["properties"]["allocated_storage_gb"]==30
    assert result["resources"][0]["properties"]["name"]=="orders"

def test_context_rejects_unverified_regions_and_missing_backups():
    for change in [{"region":"us-west-2"},{"backup":{"enabled":False}}]:
        draft=copy.deepcopy(MANIFEST);draft.update(change)
        assert validate_contextual_manifest(draft,CLOUD,POLICY,WORKSPACE)


def test_creation_endpoint_validates_and_persists_without_losing_properties():
    import httpx
    from uuid import UUID
    from fastapi.testclient import TestClient
    from src.servers.policy_server import create_app
    class Membership:
        async def get_role(self, **kwargs): return "engineer"
    requests=[]
    def transport(request):
        import json
        requests.append((request.url.path,json.loads(request.content)))
        if request.url.path.endswith("/validate"):
            return httpx.Response(200,json={"valid":True,"errors":[]})
        return httpx.Response(201,json={"id":str(UUID(int=3)),"version":1})
    context={"workspace_id":WORKSPACE,"user_id":WORKSPACE,"request_id":WORKSPACE,"correlation_id":WORKSPACE,"session_id":WORKSPACE,"permissions":["manifest:write"],"idempotency_key":"create-once"}
    client=httpx.AsyncClient(transport=httpx.MockTransport(transport))
    with TestClient(create_app(membership_store=Membership(),http_client=client)) as app:
        payload={"context":context,"agent_output":{"manifest":MANIFEST},"policy_requirements":POLICY,"cloud_context":CLOUD}
        response=app.post("/tools/create_manifest",json=payload)
        assert response.status_code==200,response.text
        assert response.json()["version"]==1
        assert requests[-1][1]["content"]["resources"][0]["properties"]["versioning"] is True
        assert requests[-1][1]["content"]["resources"][0]["source"] == {"source":"ai_assumption","confidence":0.5}
        payload["agent_output"]={"manifest":{**MANIFEST,"backup":{"enabled":False}}}
        assert app.post("/tools/create_manifest",json=payload).json()["valid"] is False
        assert len(requests)==2
