"""Consumer contract: only the operations used outside this capability."""

from app.modules.catalogs.queries import (
    sellable_packages,
)

__all__ = ['sellable_packages']
