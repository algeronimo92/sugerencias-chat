"""Historial de un chat leído directamente de WhatsApp (Evolution API).

Estos mensajes NO se guardan: son anteriores al registro propio y se muestran
al vuelo, solo de lectura. Por eso el shape de salida es parecido al de
`wsp_messages` pero sin `id` local, sin estado de entrega y sin multimedia
descargada — de un adjunto viejo se muestra el tipo y el epígrafe, no el
archivo.
"""

from services.whatsapp_history.content import (  # noqa: F401
    MESSAGE_PARSERS,
    _content_from_message,
    _normalize_record,
)
from services.whatsapp_history.envelope import _extract_records  # noqa: F401
from services.whatsapp_history.fetch import (  # noqa: F401
    MAX_EVOLUTION_CALLS,
    MAX_PAGE_CORRECTIONS,
    fetch_whatsapp_history,
)
