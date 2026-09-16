from services.db_service import (
    fetch_lead_raw,
    fetch_last_wa_message_id,
    fetch_message_by_wa_id,
    fetch_messages_raw,
)
from routers.webhooks.common import webhooks_router


router = webhooks_router()


@router.get("/lead-raw")
async def lead_raw_webhook(chat_id: str):
    """Reemplaza los nodos Postgres `get lead1` / `try to get lead`: fila
    cruda de `leads`. `{}` si no existe -el mismo shape que devolvía el nodo
    Postgres con `alwaysOutputData`- para que el chequeo `{{ $json }}` vacío
    de los IF de n8n siga funcionando sin tocarlos."""
    lead = await fetch_lead_raw(chat_id)
    return lead or {}


@router.get("/lead-messages-raw")
async def lead_messages_raw_webhook(chat_id: str, limit: int = 500):
    """Reemplaza al nodo Postgres `get messages` (contexto del copiloto de
    ventas, workflow `sugerencia`): últimos `limit` mensajes de un chat,
    crudos y más recientes primero."""
    return {"messages": await fetch_messages_raw(chat_id, limit=limit)}


@router.get("/message-by-wa-id-raw")
async def message_by_wa_id_raw_webhook(wa_message_id: str):
    """Reemplaza al nodo Postgres `buscar mensaje existente1` (chequeo de
    duplicado antes de insertar un mensaje entrante). `{}` si no existe."""
    message = await fetch_message_by_wa_id(wa_message_id)
    return message or {}


@router.get("/last-message-raw")
async def last_message_raw_webhook(chat_id: str):
    """Reemplaza al nodo Postgres `ultimo mensaje1`: el wa_message_id del
    último mensaje del chat. `{}` si el chat todavía no tiene ninguno."""
    wa_message_id = await fetch_last_wa_message_id(chat_id)
    return {"wa_message_id": wa_message_id} if wa_message_id else {}
