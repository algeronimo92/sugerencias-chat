"""Los ítems que acepta la outbox (``queue_messages``).

La forma es la del contrato de mensajes de Meta; los otros módulos los arman
a través de este contrato en lugar de depender del proveedor.
"""

from app.integrations.meta.outbound import interactive_item, media_item, text_item

__all__ = ["interactive_item", "media_item", "text_item"]
