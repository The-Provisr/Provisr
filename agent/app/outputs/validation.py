from __future__ import annotations

import json
from typing import Any

from pydantic import BaseModel, ConfigDict, TypeAdapter, ValidationError

from app.outputs.models import AgentOutputEnvelope

_ENVELOPE_ADAPTER = TypeAdapter(AgentOutputEnvelope)


class EnvelopeValidationResult(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    valid: bool
    errors: tuple[str, ...] = ()
    parsed: AgentOutputEnvelope | None = None


class _DuplicateKeyError(ValueError):
    pass


def _reject_duplicate_keys(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise _DuplicateKeyError(f"duplicate JSON field: {key}")
        result[key] = value
    return result


def validate_envelope(raw: object) -> EnvelopeValidationResult:
    """Parse untrusted agent output into one deterministic envelope variant."""

    try:
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8")
        if isinstance(raw, str):
            payload = json.loads(raw, object_pairs_hook=_reject_duplicate_keys)
        elif isinstance(raw, BaseModel):
            payload = raw.model_dump(mode="json")
        else:
            payload = raw
        parsed = _ENVELOPE_ADAPTER.validate_python(payload)
    except UnicodeDecodeError:
        return EnvelopeValidationResult(valid=False, errors=("output is not valid UTF-8",))
    except _DuplicateKeyError as error:
        return EnvelopeValidationResult(valid=False, errors=(str(error),))
    except json.JSONDecodeError as error:
        return EnvelopeValidationResult(
            valid=False,
            errors=(f"invalid JSON at line {error.lineno} column {error.colno}",),
        )
    except ValidationError as error:
        errors = tuple(
            f"{'.'.join(str(part) for part in item['loc'])}: {item['msg']}"
            for item in error.errors(include_url=False, include_context=False)
        )
        return EnvelopeValidationResult(valid=False, errors=errors)

    return EnvelopeValidationResult(valid=True, parsed=parsed)
