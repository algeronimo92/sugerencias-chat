"""Lo que otros usan del módulo de IA: entitlements para el plano de
control y el mantenimiento del conocimiento para el arranque."""

from app.modules.ai.ai_access import AIEntitlement, count_usage_this_month, get_entitlement
from app.modules.ai.knowledge_service import rechunk_outdated_documents

__all__ = ["AIEntitlement", "count_usage_this_month", "get_entitlement", "rechunk_outdated_documents"]
