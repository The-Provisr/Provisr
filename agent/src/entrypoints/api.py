"""Compatibility import for older deployments; the canonical app is app.main."""

from app.main import app

__all__ = ["app"]
