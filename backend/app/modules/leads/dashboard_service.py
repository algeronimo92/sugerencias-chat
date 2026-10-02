"""Named domain use cases; atomic persistence belongs to the repository."""
from __future__ import annotations

from app.modules.leads import dashboard_repository

async def get_dashboard_metrics(days: int) -> dict:
    return await dashboard_repository.get_dashboard_metrics(days)
