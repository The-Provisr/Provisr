"""Regenerate the MCP snapshot from the shared Pydantic runtime contract.

Run: uv run --package provisr-mcp python scripts/generate-manifest-schema.py
The existing MCP drift test compares this snapshot to the agent import path.
"""

import json
from pathlib import Path

from provisr_contracts.manifest import ResourceManifest

target = Path(__file__).resolve().parents[1] / "mcp/src/servers/manifest.schema.json"
target.write_text(
    json.dumps(ResourceManifest.model_json_schema(), indent=2) + "\n", encoding="utf-8"
)
