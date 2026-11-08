"""Consumer contract: only the operations used outside this capability."""

from app.modules.platform.knowledge_templates import get_active_template, list_templates

__all__ = ["get_active_template", "list_templates"]
