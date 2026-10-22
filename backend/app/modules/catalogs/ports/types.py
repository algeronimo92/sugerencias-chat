"""Consumer contract: only the operations used outside this capability."""

from app.modules.catalogs.types import (
    TemplateType,
    InteractiveType,
)

__all__ = ['TemplateType', 'InteractiveType']
