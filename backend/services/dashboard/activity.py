"""Traza de trabajo real del vendedor, leída de la auditoría `lead_activity`.

A diferencia del resto de los bloques, acá no se cuentan leads ni resultados
sino acciones: cambios de etapa, etiquetas, notas y actualizaciones. Es lo que
responde "qué hice esta semana" cuando los números de conversión todavía no se
movieron.
"""

import asyncio

from sqlalchemy import func, select

from db.models import LeadActivity, User, WspMessage

from .context import DashboardScope, execute_mapping, items, local_day, series


EVENT_LABELS = {
    "lead_created": "Leads creados",
    "stage_changed": "Cambios de etapa",
    "lead_updated": "Datos actualizados",
    "tag_added": "Etiquetas puestas",
    "tag_removed": "Etiquetas quitadas",
    "internal_note_created": "Notas internas",
    "internal_note_updated": "Notas editadas",
    "internal_note_deleted": "Notas borradas",
    "no_show_registered": "No-shows registrados",
    "conversation_opened": "Conversaciones abiertas",
    "conversation_closed": "Conversaciones cerradas",
    "conversation_started": "Conversaciones iniciadas por el cliente",
}


def _scoped(stmt, scope: DashboardScope):
    """En scope propio filtra por autor; en el del equipo se queda con lo que
    hizo una persona (`actor_type='user'`) y descarta el ruido del sistema y de
    las automatizaciones, que inflarían el conteo de acciones humanas."""
    if scope.is_mine:
        return stmt.where(LeadActivity.actor_user_id == scope.user_id)
    return stmt.where(LeadActivity.actor_type == "user")


async def _messages(scope: DashboardScope) -> dict:
    """Mensajes con autor conocido: los que salieron de la app.

    Un mensaje escrito desde el celular del vendedor llega como eco del webhook
    sin `sent_by_user_id` — WhatsApp no dice qué usuario del CRM lo escribió —, así
    que no entra acá. El panel cuenta trabajo hecho desde el CRM, no todo lo que
    se habló por WhatsApp.
    """
    day = local_day(WspMessage.sent_at)
    authored = WspMessage.sent_by_user_id.is_not(None)
    trend_stmt = (
        select(day.label("day"), func.count(WspMessage.id).label("total"))
        .where(WspMessage.sent_at >= scope.start, authored, scope.mine(WspMessage.sent_by_user_id))
        .group_by(day)
        .order_by(day)
    )
    author = func.coalesce(User.name, "Sin autor")
    by_user_stmt = (
        select(author.label("name"), func.count(WspMessage.id).label("value"))
        .outerjoin(User, User.id == WspMessage.sent_by_user_id)
        .where(WspMessage.sent_at >= scope.start, authored)
        .group_by(author)
        .order_by(func.count(WspMessage.id).desc())
        .limit(12)
    )
    trend, by_user = await asyncio.gather(
        execute_mapping(trend_stmt), execute_mapping(by_user_stmt)
    )
    return {"trend": series(trend, scope), "by_user": items(by_user)}


async def collect(scope: DashboardScope) -> dict:
    day = local_day(LeadActivity.created_at)
    trend_stmt = _scoped(
        select(day.label("day"), func.count(LeadActivity.id).label("total"))
        .where(LeadActivity.created_at >= scope.start)
        .group_by(day)
        .order_by(day),
        scope,
    )
    by_type_stmt = _scoped(
        select(LeadActivity.event_type.label("name"), func.count(LeadActivity.id).label("value"))
        .where(LeadActivity.created_at >= scope.start)
        .group_by(LeadActivity.event_type)
        .order_by(func.count(LeadActivity.id).desc())
        .limit(10),
        scope,
    )
    actor = func.coalesce(User.name, "Sistema")
    by_user_stmt = (
        select(actor.label("name"), func.count(LeadActivity.id).label("value"))
        .outerjoin(User, User.id == LeadActivity.actor_user_id)
        .where(
            LeadActivity.created_at >= scope.start,
            LeadActivity.actor_type == "user",
        )
        .group_by(actor)
        .order_by(func.count(LeadActivity.id).desc())
        .limit(12)
    )

    trend, by_type, by_user, messages = await asyncio.gather(
        execute_mapping(trend_stmt),
        execute_mapping(by_type_stmt),
        execute_mapping(by_user_stmt),
        _messages(scope),
    )
    return {
        "trend": series(trend, scope),
        "by_type": [
            {"name": EVENT_LABELS.get(row["name"], str(row["name"])), "value": int(row["value"])}
            for row in by_type
        ],
        "by_user": items(by_user),
        "messages": messages,
    }
