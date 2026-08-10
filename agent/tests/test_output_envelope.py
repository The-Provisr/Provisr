import json

import pytest

from app.outputs.validation import validate_envelope

REQUEST_ID = "8b8c64dc-6607-4a45-aa71-f51b2d381cdf"
METADATA = {"confidence": 0.95, "source": "llm_generated", "warnings": []}
MANIFEST = {
    "schema_version": "1.0",
    "provider": "aws",
    "region": "ap-southeast-1",
    "environment": "development",
    "tags": {"managed-by": "provisr"},
    "resources": [
        {
            "type": "aws_ec2",
            "name": "api-server",
            "instance_type": "t3.micro",
            "image": "ami-12345678",
            "count": 1,
        }
    ],
}


def envelope(output_type: str, data: dict[str, object]) -> dict[str, object]:
    return {
        "type": output_type,
        "version": "1.0.0",
        "request_id": REQUEST_ID,
        "data": data,
        "metadata": METADATA,
    }


@pytest.mark.parametrize(
    ("output_type", "data"),
    [
        ("assistant_message", {"message": "Here is a safe explanation."}),
        (
            "component_payload",
            {"component_id": "cost.summary", "payload": {"monthly_usd": 20}},
        ),
        ("manifest_draft", {"message": "Draft ready.", "manifest": MANIFEST}),
        ("clarification_question", {"question": "Which region should I use?"}),
        (
            "tool_summary",
            {"tool_name": "estimate_cost", "summary": "Estimated cost is $20/month."},
        ),
        (
            "error",
            {"code": "policy_unavailable", "message": "Policy is unavailable.", "retryable": True},
        ),
    ],
)
def test_validates_every_type_specific_envelope(
    output_type: str,
    data: dict[str, object],
) -> None:
    result = validate_envelope(json.dumps(envelope(output_type, data)))

    assert result.valid is True
    assert result.errors == ()
    assert result.parsed is not None
    assert result.parsed.type == output_type
    assert str(result.parsed.request_id) == REQUEST_ID


@pytest.mark.parametrize(
    "mutation",
    [
        {"version": "v1"},
        {"request_id": "not-a-uuid"},
        {"type": "unknown"},
        {"metadata": {"confidence": 1.1, "source": "llm_generated", "warnings": []}},
        {"metadata": {"confidence": 0.9, "source": "unknown", "warnings": []}},
        {"unexpected": True},
    ],
)
def test_rejects_invalid_common_envelope_fields(mutation: dict[str, object]) -> None:
    payload = envelope("assistant_message", {"message": "Safe response."})
    payload.update(mutation)

    result = validate_envelope(payload)

    assert result.valid is False
    assert result.parsed is None
    assert result.errors


def test_rejects_data_for_a_different_output_type() -> None:
    result = validate_envelope(
        envelope("clarification_question", {"message": "Wrong field for this type."})
    )

    assert result.valid is False
    assert any("question" in error for error in result.errors)


def test_rejects_duplicate_json_fields() -> None:
    raw = (
        '{"type":"assistant_message","type":"error","version":"1.0.0",'
        f'"request_id":"{REQUEST_ID}",'
        '"data":{"message":"Unsafe ambiguity"},'
        '"metadata":{"confidence":1,"source":"llm_generated","warnings":[]}}'
    )

    result = validate_envelope(raw)

    assert result.valid is False
    assert result.errors == ("duplicate JSON field: type",)


def test_validation_result_serializes_to_required_shape() -> None:
    result = validate_envelope(
        envelope("assistant_message", {"message": "A deterministic response."})
    )

    payload = result.model_dump(mode="json")

    assert payload["valid"] is True
    assert payload["errors"] == []
    assert payload["parsed"]["type"] == "assistant_message"
