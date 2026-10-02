"""Consumer contract: only the operations used outside this capability."""

from app.modules.catalogs.repository import (
    assign_tag,
    remove_tag,
)

__all__ = ['assign_tag', 'remove_tag']
