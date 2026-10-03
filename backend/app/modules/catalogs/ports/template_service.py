"""Consumer contract: only the operations used outside this capability."""

from app.modules.catalogs.template_queries import (
    list_templates,
)
from app.modules.catalogs.template_service import (
    record_template_use,
    replace_official_template_from_meta,
)

__all__ = ['list_templates', 'record_template_use', 'replace_official_template_from_meta']
