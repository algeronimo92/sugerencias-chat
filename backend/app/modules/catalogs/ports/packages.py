"""Consumer contract: el paquete que un lead compra (lo usa leads)."""

from app.modules.catalogs.queries import get_sellable_package

__all__ = ["get_sellable_package"]
