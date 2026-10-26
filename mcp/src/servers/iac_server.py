"""Standalone MCP IaC server using the shared authenticated runtime."""
from src.servers.policy_server import create_app

app = create_app()
