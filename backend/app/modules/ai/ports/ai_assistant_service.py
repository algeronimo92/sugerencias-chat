"""Consumer contract: only the operations used outside this capability."""

from app.modules.ai.ai_assistant_service import (
    fetch_tenant_config,
    list_ai_catalog,
    list_ai_resources,
)

__all__ = ['fetch_tenant_config', 'list_ai_catalog', 'list_ai_resources']
