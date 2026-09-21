import re
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select, true

from db.models import LeadStage, LeadTag, LeadTagAssignment
from services.time_format import iso_utc_micros, parse_iso_utc_micros

CHATS_PAGE_SIZE = 30
KANBAN_PAGE_SIZE = 40
MESSAGES_PAGE_SIZE = 50
# Cuántas dimensiones de multimedia se miden a la vez al abrir un historial.
MEDIA_DIMENSION_CONCURRENCY = 6
CUSTOMER_SERVICE_WINDOW = timedelta(hours=24)


class LeadAlreadyExistsError(Exception):
    pass


class EmailAlreadyExistsError(Exception):
    pass


class TagAlreadyExistsError(Exception):
    pass


class LeadServiceAlreadyExistsError(Exception):
    pass


class LastAdminError(Exception):
    """Se levanta al intentar desactivar/degradar al único admin activo."""

    pass


_fmt_ts = iso_utc_micros


def _activity_safe(values: dict) -> dict:
    """old_value/new_value son columnas JSONB: un date o un datetime crudo
    rompe el json.dumps del driver. El UPDATE sigue recibiendo los objetos
    originales — esto es solo para la auditoría."""
    return {
        key: value.isoformat() if isinstance(value, (date, datetime)) else value
        for key, value in values.items()
    }


def _phone_to_jid(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    return f"{digits}@s.whatsapp.net"


def _row_to_chat(row, tags: list[dict] | None = None) -> dict:
    stage = row["stage"]
    return {
        "chat_id": row["chat_id"],
        "phone": row["phone"],
        "secondary_phone": row["secondary_phone"] if "secondary_phone" in row else None,
        "username": row["username"] if "username" in row else None,
        "name": row["name"],
        "servicio_interes": row["servicio_interes"],
        "vendedor_id": row["vendedor_id"],
        "vendedor": row["vendedor"],
        "origen": row["origen"],
        "notas": row["notas"],
        "stage": stage.value if isinstance(stage, LeadStage) else stage,
        "con_especialista": row["con_especialista"],
        "automatizacion_pausada": row["automatizacion_pausada"],
        "conversacion_abierta": row["conversacion_abierta"],
        "conversacion_abierta_at": _fmt_ts(row["conversacion_abierta_at"]),
        "conversacion_cerrada_at": _fmt_ts(row["conversacion_cerrada_at"]),
        "conversacion_version": row["conversacion_version"],
        "razon_perdido": row["razon_perdido"],
        "fecha_recontacto": row["fecha_recontacto"].isoformat() if row["fecha_recontacto"] else None,
        "proxima_cita": _fmt_ts(row["proxima_cita"]),
        "contador_noshow": row["contador_noshow"],
        "toques_seguimiento": row["toques_seguimiento"],
        "fecha_ultimo_toque": _fmt_ts(row["fecha_ultimo_toque"]),
        # De un mensaje eliminado no se sirve el texto ni en el preview: la
        # lista lo muestra como "Se eliminó este mensaje" a partir del flag.
        "last_message": None if row["last_message_deleted_at"] else row["last_message"],
        "last_message_sender": row["last_message_sender"],
        "last_message_type": row["last_message_type"] if "last_message_type" in row else None,
        "last_message_deleted": row["last_message_deleted_at"] is not None,
        "timestamp": _fmt_ts(row["timestamp"]),
        "last_customer_message_at": _fmt_ts(row["last_customer_message_at"]),
        "unread_count": row["unread_count"],
        # Crudos para que el frontend decida el color del badge: "no leído"
        # a secas si nadie contestó, o "atendido por bot" si la última
        # respuesta automática es más nueva que la última lectura humana.
        "last_read_at": _fmt_ts(row["last_read_at"]),
        "last_automated_reply_at": _fmt_ts(row["last_automated_reply_at"]),
        "tags": tags or [],
        # Presentes solo cuando la consulta llevaba búsqueda activa.
        "search_rank": row["search_rank"] if "search_rank" in row else 2,
        "matched_message": row["matched_message"] if "matched_message" in row else None,
        "matched_message_id": row["matched_message_id"] if "matched_message_id" in row else None,
    }


def _tag_dict(row) -> dict:
    return {"id": row["id"], "name": row["name"], "color": row["color"]}


async def _tags_by_lead(session, chat_ids: list[str]) -> dict[str, list[dict]]:
    if not chat_ids:
        return {}
    stmt = (
        select(
            LeadTagAssignment.lead_id,
            LeadTag.id,
            LeadTag.name,
            LeadTag.color,
        )
        .join(LeadTag, LeadTag.id == LeadTagAssignment.tag_id)
        .where(LeadTagAssignment.lead_id.in_(chat_ids), LeadTag.is_active == true())
        .order_by(LeadTag.name.asc())
    )
    rows = (await session.execute(stmt)).mappings().all()
    result: dict[str, list[dict]] = {chat_id: [] for chat_id in chat_ids}
    for row in rows:
        result[row["lead_id"]].append(_tag_dict(row))
    return result


_parse_ts = parse_iso_utc_micros


def _json_safe_row(row: dict) -> dict:
    """Convierte una fila cruda (``SELECT *`` vía SQL crudo) a JSON-safe:
    datetime/date a ISO, bytes a None (no serializable, sin uso fuera de la
    app). Lo demás (str, int, bool, dict de columnas JSONB) ya es JSON-safe."""
    result = {}
    for key, value in row.items():
        if isinstance(value, datetime):
            result[key] = _fmt_ts(value)
        elif isinstance(value, date):
            result[key] = value.isoformat()
        elif isinstance(value, (bytes, bytearray)):
            result[key] = None
        else:
            result[key] = value
    return result
