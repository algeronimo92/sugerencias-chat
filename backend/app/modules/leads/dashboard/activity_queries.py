"""Traza de trabajo real del vendedor, leída de la auditoría `lead_activity`.

A diferencia del resto de los bloques, acá no se cuentan leads ni resultados
sino acciones: cambios de etapa, etiquetas, notas y actualizaciones. Es lo que
responde "qué hice esta semana" cuando los números de conversión todavía no se
movieron.
"""

import asyncio
from datetime import timedelta

from sqlalchemy import case, func, select
from sqlalchemy.orm import aliased

from app.db.models.auth import User
from app.db.models.conversations import MessageOutbox, WspMessage
from app.db.models.leads import Lead, LeadActivity

from app.modules.conversations.public import AUTOMATION_KEY_PREFIX, SCHEDULED_KEY_PREFIX
from app.modules.leads.dashboard.scope import (
    DashboardScope, execute_mapping, items, local_day, local_slot, local_weekday, message_went_out, series,
)


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
    went_out = message_went_out(WspMessage.outbox_status, WspMessage.meta_status)
    trend_stmt = (
        select(day.label("day"), func.count(WspMessage.id).label("total"))
        .where(WspMessage.sent_at >= scope.start, authored, went_out, scope.mine(WspMessage.sent_by_user_id))
        .group_by(day)
        .order_by(day)
    )
    author = func.coalesce(User.name, "Sin autor")
    by_user_stmt = (
        select(author.label("name"), func.count(WspMessage.id).label("value"))
        .outerjoin(User, User.id == WspMessage.sent_by_user_id)
        .where(WspMessage.sent_at >= scope.start, authored, went_out)
        .group_by(author)
        .order_by(func.count(WspMessage.id).desc())
        .limit(12)
    )
    trend, by_user, by_origin = await asyncio.gather(
        execute_mapping(trend_stmt), execute_mapping(by_user_stmt), execute_mapping(_by_origin_stmt(scope)),
    )
    return {
        "trend": series(trend, scope),
        "by_user": items(by_user),
        "by_origin": _origin_series(by_origin, scope),
    }


ORIGINS = ("app", "automation", "scheduled", "phone")


def _by_origin_stmt(scope: DashboardScope):
    """Todo lo que mandó el negocio, por día y por de dónde salió.

    "Mensajes enviados" contaba solo los de la app, y un día en que el equipo
    contestó desde el celular y los flujos trabajaron se veía en cero. Parte de la regla con que el chat rotula cada burbuja
    (`conversations/domain/origin.py`): la clave del outbox distingue flujos y
    programados, y un mensaje sin fila de outbox llegó como eco del celular.
    A diferencia del chat, "app" exige autor: lo que salió del outbox sin
    autor ni clave es un flujo viejo.

    En el scope propio se acota a los chats de la persona: los ecos y los
    flujos no tienen autor, así que no hay otra forma de atribuírselos.
    """
    origin = case(
        (MessageOutbox.dedupe_key.startswith(AUTOMATION_KEY_PREFIX), "automation"),
        (MessageOutbox.dedupe_key.startswith(SCHEDULED_KEY_PREFIX), "scheduled"),
        (MessageOutbox.id.is_(None), "phone"),
        (WspMessage.sent_by_user_id.is_not(None), "app"),
        # Salió por el outbox sin autor ni clave: son los flujos de antes de que
        # tuvieran clave propia (hasta el 2026-11-01). Contados como "app"
        # inflaban esa barra muy por encima de los mensajes con autor real.
        # Todo envío de una persona desde la app guarda su autor.
        else_="automation",
    )
    day = local_day(WspMessage.sent_at)
    stmt = (
        select(day.label("day"), origin.label("origin"), func.count(WspMessage.id).label("total"))
        .outerjoin(MessageOutbox, MessageOutbox.message_id == WspMessage.id)
        .where(
            WspMessage.sent_at >= scope.start,
            WspMessage.sender == "vendedor",
            message_went_out(WspMessage.outbox_status, WspMessage.meta_status),
        )
        .group_by(day, origin)
    )
    if scope.is_mine:
        stmt = stmt.join(Lead, Lead.id == WspMessage.chat_id).where(Lead.vendedor_id == scope.user_id)
    return stmt


def _origin_series(rows, scope: DashboardScope) -> list[dict]:
    """Un punto por día con los cuatro orígenes en cero si no hubo nada."""
    counts = {(row["day"], row["origin"]): int(row["total"]) for row in rows}
    points = []
    for offset in range(scope.days):
        day = scope.start_date + timedelta(days=offset)
        points.append({"date": day.isoformat(), **{name: counts.get((day, name), 0) for name in ORIGINS}})
    return points


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


def _hand_written_by_hour(*extra_columns):
    """Mensajes que una persona escribió y mandó en el momento desde el CRM.

    Es la lectura de "a qué hora trabaja alguien en la app", así que deja
    fuera todo lo que no ocurrió a esa hora por mano de esa persona: los
    programados (tienen autora, pero salieron solos a la hora que ella eligió
    antes), los flujos y los ecos del celular, que llegan sin autor.
    """
    weekday, slot = local_weekday(WspMessage.sent_at), local_slot(WspMessage.sent_at)
    scheduled = MessageOutbox.dedupe_key.startswith(SCHEDULED_KEY_PREFIX)
    return (
        select(*extra_columns, weekday.label("weekday"), slot.label("slot"), func.count(WspMessage.id).label("messages"))
        .outerjoin(MessageOutbox, MessageOutbox.message_id == WspMessage.id)
        .where(
            WspMessage.sent_by_user_id.is_not(None),
            # Sin fila de outbox la clave es NULL y `NOT LIKE` daría NULL: hay
            # que dejar pasar ese caso a propósito.
            MessageOutbox.dedupe_key.is_(None) | ~scheduled,
            message_went_out(WspMessage.outbox_status, WspMessage.meta_status),
        )
        .group_by(*extra_columns, weekday, slot)
    )


def messages_by_hour_stmt(scope: DashboardScope):
    return _hand_written_by_hour().where(
        WspMessage.sent_at >= scope.start, scope.mine(WspMessage.sent_by_user_id),
    )


def messages_by_author_hour_stmt(scope: DashboardScope):
    """Lo mismo, de todo el equipo y partido por autora: de acá sale la escala
    común con que se pintan los mapas de cada persona."""
    return _hand_written_by_hour(WspMessage.sent_by_user_id.label("person")).where(
        WspMessage.sent_at >= scope.start,
    )


def _phone_by_hour(*extra_columns):
    """Lo que el negocio mandó desde WhatsApp sin pasar por el CRM.

    Es la mitad que el mapa de lo escrito en el CRM no ve: quien atiende desde
    el celular salía en blanco aunque trabajara. Estos mensajes llegan como
    eco, sin autora, así que se atribuyen a la vendedora dueña del chat; y
    WhatsApp tampoco avisa si los escribió una persona, de modo que entran sus
    respuestas automáticas y difusiones.
    """
    weekday, slot = local_weekday(WspMessage.sent_at), local_slot(WspMessage.sent_at)
    return (
        select(*extra_columns, weekday.label("weekday"), slot.label("slot"), func.count(WspMessage.id).label("phone_messages"))
        .join(Lead, Lead.id == WspMessage.chat_id)
        .outerjoin(MessageOutbox, MessageOutbox.message_id == WspMessage.id)
        .where(
            WspMessage.sender == "vendedor",
            MessageOutbox.id.is_(None),
            message_went_out(WspMessage.outbox_status, WspMessage.meta_status),
        )
        .group_by(*extra_columns, weekday, slot)
    )


def phone_by_hour_stmt(scope: DashboardScope):
    return _phone_by_hour().where(WspMessage.sent_at >= scope.start, scope.mine(Lead.vendedor_id))


def phone_by_owner_hour_stmt(scope: DashboardScope):
    """Del equipo entero y partido por dueña del chat: da la escala común."""
    return _phone_by_hour(Lead.vendedor_id.label("person")).where(
        WspMessage.sent_at >= scope.start, Lead.vendedor_id.is_not(None),
    )


def team_members_stmt():
    """Quiénes pueden aparecer en la comparación del equipo por horas. Sin
    filtro: `hours_queries` decide a quién lista (vendedoras activas, más
    cualquiera con actividad en el período)."""
    return select(User.id.label("person"), User.name.label("name"), User.role.label("role"), User.is_active.label("is_active"))


# Ventana fija para "siguió conversando": sin ella, una conversación de hace un
# mes tendría más oportunidad de contar que una de ayer y las celdas no serían
# comparables. Coincide con la ventana de servicio de WhatsApp.
ENGAGEMENT_WINDOW = timedelta(hours=24)


def conversations_by_hour_stmt(scope: DashboardScope):
    """Leads creados en el período y cuántos volvieron a escribir.

    "Siguió conversando" cuenta turnos, no mensajes: mucha gente manda "hola",
    "info", "precio?" en diez segundos, antes de que nadie conteste, y eso no es
    avance. Lo que cuenta es que el cliente escriba de nuevo después de nuestra
    primera respuesta — humana o automática: si solo valiera la humana, la
    madrugada saldría en cero aunque el flujo automático la esté sosteniendo.

    Los leads con menos de 24 h todavía no tuvieron su ventana completa; van en
    `conversations` pero no en `settled`, que es el denominador del porcentaje.
    """
    reply = aliased(WspMessage)
    customer = aliased(WspMessage)
    first_reply = (
        select(func.min(reply.sent_at))
        .where(reply.chat_id == Lead.id, reply.sender != "cliente", reply.sent_at >= Lead.created_at)
        .correlate(Lead)
        .scalar_subquery()
    )
    followed_up = (
        select(customer.id)
        .where(
            customer.chat_id == Lead.id,
            customer.sender == "cliente",
            customer.sent_at > first_reply,
            customer.sent_at <= Lead.created_at + ENGAGEMENT_WINDOW,
        )
        .correlate(Lead)
        .exists()
    )
    settled = Lead.created_at <= scope.now - ENGAGEMENT_WINDOW
    weekday, slot = local_weekday(Lead.created_at), local_slot(Lead.created_at)
    return (
        select(
            weekday.label("weekday"),
            slot.label("slot"),
            func.count(Lead.id).label("conversations"),
            func.count(Lead.id).filter(settled).label("settled"),
            func.count(Lead.id).filter(settled & followed_up).label("engaged"),
        )
        .where(Lead.created_at >= scope.start, scope.mine(Lead.vendedor_id))
        .group_by(weekday, slot)
    )
