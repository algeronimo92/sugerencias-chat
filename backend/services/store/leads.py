import logging
import re
from datetime import datetime, timezone

from sqlalchemy import exists, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError, SQLAlchemyError

from db.models import Lead, LeadActivity, LeadStage, User, WhatsAppIdentity, WspMessage
from db.session import get_sessionmaker
from domain_types import AutomationTrigger
from services.automation_scheduling import schedule_automation_event_in_session
from services.store.chat_queries import (
    fetch_chat,
)
from services.store.common import (
    LeadAlreadyExistsError,
    _activity_safe,
    _fmt_ts,
    _json_safe_row,
    _phone_to_jid,
)

logger = logging.getLogger(__name__)


async def _record_activity(
    session,
    lead_id: str,
    event_type: str,
    actor_type: str,
    actor_user_id: int | None = None,
    old_value: dict | None = None,
    new_value: dict | None = None,
    metadata: dict | None = None,
) -> None:
    await session.execute(_activity_insert(
        lead_id, event_type, actor_type, actor_user_id, old_value, new_value, metadata,
    ))


def _activity_insert(
    lead_id: str,
    event_type: str,
    actor_type: str,
    actor_user_id: int | None,
    old_value: dict | None,
    new_value: dict | None,
    metadata: dict | None,
):
    return insert(LeadActivity).values(
        lead_id=lead_id,
        event_type=event_type,
        actor_type=actor_type,
        actor_user_id=actor_user_id,
        old_value=old_value,
        new_value=new_value,
        metadata_=metadata,
        created_at=datetime.now(timezone.utc),
    )


async def _schedule_stage_automations(
    session, chat_id: str, activity_id: int, old_value: dict, new_value: dict,
) -> int:
    try:
        async with session.begin_nested():
            return await schedule_automation_event_in_session(
                session,
                AutomationTrigger.STAGE_CHANGED,
                chat_id,
                f"stage:{activity_id}",
                {"old_value": old_value, "new_value": new_value},
            )
    except SQLAlchemyError:
        logger.exception("No se pudieron agendar las automatizaciones del cambio de etapa de %s", chat_id)
        return 0


async def update_lead_stage(
    chat_id: str,
    stage: LeadStage,
    actor_type: str = "system",
    actor_user_id: int | None = None,
    metadata: dict | None = None,
    include_chat: bool = True,
    razon_perdido: str | None = None,
    schedule_automations: bool = True,
) -> dict | None:
    automations_scheduled = 0
    async with get_sessionmaker()() as session:
        old_stage = (
            await session.execute(select(Lead.estado).where(Lead.id == chat_id).with_for_update())
        ).scalar_one_or_none()
        if old_stage is None:
            return None
        changed = old_stage != stage
        if changed:
            # La razón de pérdida describe la situación actual del lead, no su
            # historia: entra al pasar a `perdido` y se limpia al salir. Lo
            # dicho queda igual en lead_activity (metadata.reason), que es lo
            # que muestra el hilo del chat.
            extra: dict = {}
            razon = (razon_perdido or "").strip()
            if stage == LeadStage.perdido:
                if razon:
                    extra["razon_perdido"] = razon
                    metadata = {**(metadata or {}), "reason": razon}
            elif old_stage == LeadStage.perdido:
                extra["razon_perdido"] = None
            await session.execute(
                update(Lead)
                .where(Lead.id == chat_id)
                .values(estado=stage, updated_at=datetime.now(timezone.utc), **extra)
            )
            # Se congela el último mensaje del cliente en la auditoría: el
            # chat sigue creciendo después del cambio, así que sin esta foto
            # no habría forma de saber qué dijo la persona para ser movida.
            trigger = (
                await session.execute(
                    select(WspMessage.id, WspMessage.content, WspMessage.sent_at)
                    .where(WspMessage.chat_id == chat_id, WspMessage.sender == "cliente")
                    .order_by(WspMessage.sent_at.desc(), WspMessage.id.desc())
                    .limit(1)
                )
            ).mappings().first()
            if trigger is not None:
                content = (trigger["content"] or "").strip()
                if len(content) > 300:
                    content = content[:300] + "…"
                metadata = {
                    **(metadata or {}),
                    "trigger_message": {
                        "id": trigger["id"],
                        "content": content,
                        "sent_at": _fmt_ts(trigger["sent_at"]),
                    },
                }
            old_value = {"stage": old_stage.value if isinstance(old_stage, LeadStage) else old_stage}
            new_value = {"stage": stage.value}
            activity_id = (await session.execute(_activity_insert(
                chat_id, AutomationTrigger.STAGE_CHANGED, actor_type, actor_user_id,
                old_value, new_value, metadata,
            ).returning(LeadActivity.id))).scalar_one()
            if schedule_automations:
                automations_scheduled = await _schedule_stage_automations(
                    session, chat_id, activity_id, old_value, new_value,
                )
        await session.commit()

    if not include_chat:
        return {
            "chat_id": chat_id,
            "stage": stage.value,
            "changed": changed,
            "automations_scheduled": automations_scheduled,
        }
    chat = await fetch_chat(chat_id)
    return {**chat, "automations_scheduled": automations_scheduled} if chat else chat


async def mark_lead_no_show(chat_id: str, actor_user_id: int) -> dict | None:
    """El vendedor confirma que el cliente no llegó a la cita agendada.

    Es una acción humana a propósito: el sistema no tiene forma de saber por
    sí solo si alguien asistió físicamente a la clínica.
    """
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        lead = await session.get(Lead, chat_id, with_for_update=True)
        if lead is None:
            return None
        lead.contador_noshow = (lead.contador_noshow or 0) + 1
        lead.updated_at = now
        await _record_activity(
            session,
            chat_id,
            "no_show_registered",
            "user",
            actor_user_id,
            None,
            {"contador_noshow": lead.contador_noshow},
        )
        await session.commit()
    return await fetch_chat(chat_id)


async def delete_lead(chat_id: str) -> bool:
    """Borra un lead entero: mensajes, tareas, notas, todo lo que cuelga de
    él por FK en CASCADE. No hay soft-delete para leads, así que esto no se
    puede deshacer.
    """
    async with get_sessionmaker()() as session:
        lead = await session.get(Lead, chat_id)
        if lead is None:
            return False
        await session.delete(lead)
        await session.commit()
    return True


async def create_lead(
    phone: str,
    name: str,
    servicio_interes: str | None = None,
    vendedor_id: int | None = None,
    origen: str | None = None,
    notas: str | None = None,
    secondary_phone: str | None = None,
    actor_user_id: int | None = None,
    remote_jid: str | None = None,
) -> dict:
    # phone llega ya normalizado (solo dígitos E.164). Si Evolution devolvió el
    # JID canónico se usa ese — puede diferir del tipeado (p. ej. México/AR) y
    # entonces telefono se deriva del JID, que es la identidad real del chat.
    external_jid = remote_jid or _phone_to_jid(phone)
    digits = re.sub(r"\D", "", external_jid.split("@", 1)[0]) or re.sub(r"\D", "", phone)
    seller_name = None
    if vendedor_id is not None:
        async with get_sessionmaker()() as lookup_session:
            seller = await lookup_session.get(User, vendedor_id)
            if seller is None or not seller.is_active:
                raise ValueError("Vendedor no encontrado o inactivo")
            seller_name = seller.name
    stmt = insert(Lead).values(
        legacy_remote_jid=external_jid,
        telefono=digits,
        telefono_secundario=secondary_phone,
        nombre=name,
        servicio_interes=servicio_interes,
        vendedor_id=vendedor_id,
        vendedor=seller_name,
        origen=origen,
        notas=notas,
    ).returning(Lead.id)
    async with get_sessionmaker()() as session:
        try:
            lead_id = (await session.execute(stmt)).scalar_one()
            await session.execute(insert(WhatsAppIdentity).values(
                instance="*", jid=external_jid, kind="phone", lead_id=lead_id,
            ))
            await _record_activity(
                session,
                lead_id,
                AutomationTrigger.LEAD_CREATED,
                "user" if actor_user_id is not None else "system",
                actor_user_id,
                new_value={"name": name, "phone": digits},
            )
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise LeadAlreadyExistsError(external_jid)

    return await fetch_chat(lead_id)


async def fetch_lead_raw(chat_id: str) -> dict | None:
    """Fila cruda de ``leads`` (todas las columnas de la tabla, incluidas las
    que no están mapeadas en el ORM: ``metadata``, ``ultimo_emisor``,
    ``tipo_objecion``). La usan los endpoints que reemplazan a los nodos
    Postgres ``get lead1``/``try to get lead`` de n8n, que hacían
    ``SELECT * FROM leads WHERE id = ...`` directo."""
    async with get_sessionmaker()() as session:
        row = (
            await session.execute(
                text("SELECT * FROM leads WHERE id = :id"), {"id": chat_id}
            )
        ).mappings().first()
    if row is None:
        return None
    return _json_safe_row(dict(row))


async def fetch_messages_raw(chat_id: str, limit: int = 500) -> list[dict]:
    """Filas crudas de ``wsp_messages`` de un chat, más recientes primero.
    Reemplaza al nodo Postgres ``get messages`` de n8n. Sin
    ``message_secret`` (bytes, no serializable y sin uso fuera de la app)."""
    async with get_sessionmaker()() as session:
        rows = (
            await session.execute(
                text(
                    "SELECT * FROM wsp_messages WHERE chat_id = :chat_id "
                    "ORDER BY id DESC LIMIT :limit"
                ),
                {"chat_id": chat_id, "limit": limit},
            )
        ).mappings().all()
    result = []
    for row in rows:
        data = _json_safe_row(dict(row))
        data.pop("message_secret", None)
        result.append(data)
    return result


async def ensure_lead_stub(
    chat_id: str, ultimo_mensaje_at: datetime | None, origen: str | None
) -> dict:
    """Alta idempotente de un lead mínimo para un mensaje entrante nuevo.
    Reemplaza al nodo Postgres ``create lead`` de n8n: ``INSERT ... ON
    CONFLICT (id) DO NOTHING``, sin pisar nada si el lead ya existía (el
    ``ultimo_mensaje_at`` va en el mismo INSERT; con ON CONFLICT DO NOTHING
    un lead existente no lo toca).
    """
    stmt = (
        pg_insert(Lead)
        .values(
            id=chat_id, estado=LeadStage.nuevo, origen=origen, conversacion_version=0,
            ultimo_mensaje_at=ultimo_mensaje_at,
        )
        .on_conflict_do_nothing(index_elements=[Lead.id])
    )
    async with get_sessionmaker()() as session:
        await session.execute(stmt)
        await session.commit()
    return await fetch_lead_raw(chat_id) or {}


async def update_lead(
    chat_id: str,
    values: dict,
    actor_type: str = "system",
    actor_user_id: int | None = None,
) -> dict | None:
    if not values:
        return await fetch_chat(chat_id)

    async with get_sessionmaker()() as session:
        if "vendedor_id" in values:
            seller_id = values["vendedor_id"]
            if seller_id is None:
                values["vendedor"] = None
            else:
                seller = await session.get(User, seller_id)
                if seller is None or not seller.is_active:
                    raise ValueError("Vendedor no encontrado o inactivo")
                # Espejo de compatibilidad; vendedor_id sigue siendo la fuente real.
                values["vendedor"] = seller.name
        columns = [getattr(Lead, key) for key in values]
        old_row = (
            await session.execute(select(*columns).where(Lead.id == chat_id).with_for_update())
        ).mappings().first()
        if old_row is None:
            return None
        changed = {key: value for key, value in values.items() if old_row[key] != value}
        if changed:
            now = datetime.now(timezone.utc)
            db_changes = dict(changed)
            conversation_changed = "conversacion_abierta" in changed
            if conversation_changed:
                if changed["conversacion_abierta"]:
                    db_changes.update(
                        conversacion_abierta_at=now,
                        conversacion_cerrada_at=None,
                        conversacion_version=Lead.conversacion_version + 1,
                    )
                else:
                    db_changes["conversacion_cerrada_at"] = now
            await session.execute(
                update(Lead)
                .where(Lead.id == chat_id)
                .values(**db_changes, updated_at=now)
            )
            await _record_activity(
                session,
                chat_id,
                (
                    "conversation_opened"
                    if conversation_changed and changed["conversacion_abierta"]
                    else "conversation_closed"
                    if conversation_changed
                    else "lead_updated"
                ),
                actor_type,
                actor_user_id,
                _activity_safe({key: old_row[key] for key in changed}),
                _activity_safe(changed),
            )
        await session.commit()

    return await fetch_chat(chat_id)


async def open_conversation_from_inbound(
    chat_id: str,
    message_id: str,
    content: str | None = None,
) -> dict | None:
    """Abre atómicamente una conversación cerrada por un mensaje entrante.

    El WHERE sobre ``conversacion_abierta`` hace que dos webhooks concurrentes
    no puedan crear dos conversaciones. La versión identifica esta apertura
    de forma estable para deduplicar la ejecución de cada regla.
    """
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        row = (await session.execute(
            update(Lead)
            .where(Lead.id == chat_id, Lead.conversacion_abierta.is_(False))
            .values(
                conversacion_abierta=True,
                conversacion_abierta_at=now,
                conversacion_cerrada_at=None,
                conversacion_version=Lead.conversacion_version + 1,
                updated_at=now,
            )
            .returning(Lead.conversacion_version, Lead.conversacion_abierta_at)
        )).mappings().first()
        if row is None:
            await session.rollback()
            return None
        version = int(row["conversacion_version"])
        await _record_activity(
            session,
            chat_id,
            AutomationTrigger.CONVERSATION_STARTED,
            "system",
            old_value={"conversacion_abierta": False},
            new_value={
                "conversacion_abierta": True,
                "conversacion_version": version,
            },
            metadata={"message_id": message_id, "content": content},
        )
        await session.commit()
    return {
        "version": version,
        "opened_at": _fmt_ts(row["conversacion_abierta_at"]),
    }


async def rekey_lead_phone(
    lead_id: str,
    new_digits: str,
    new_jid: str | None = None,
    actor_user_id: int | None = None,
) -> dict | None:
    """Cambia el teléfono/alias sin cambiar la identidad interna del lead."""
    target_jid = new_jid or _phone_to_jid(new_digits)
    # Igual que en create_lead: si el JID canónico difiere de lo tipeado,
    # telefono se deriva del JID, que es la identidad real del chat.
    new_digits = re.sub(r"\D", "", target_jid.split("@", 1)[0]) or new_digits
    async with get_sessionmaker()() as session:
        lead = await session.get(Lead, lead_id, with_for_update=True)
        if lead is None:
            return None

        collision = await session.scalar(select(exists().where(
            WhatsAppIdentity.jid == target_jid,
            WhatsAppIdentity.lead_id != lead_id,
        )))
        if collision:
            raise LeadAlreadyExistsError(target_jid)

        old_phone = lead.telefono
        phone_aliases = (await session.execute(select(WhatsAppIdentity).where(
            WhatsAppIdentity.lead_id == lead_id,
            WhatsAppIdentity.kind == "phone",
        ).with_for_update())).scalars().all()
        if phone_aliases:
            for alias in phone_aliases:
                alias.jid = target_jid
                alias.updated_at = datetime.now(timezone.utc)
        else:
            session.add(WhatsAppIdentity(
                instance="*", jid=target_jid, kind="phone", lead_id=lead_id,
            ))
        lead.legacy_remote_jid = target_jid
        lead.telefono = new_digits
        lead.updated_at = datetime.now(timezone.utc)

        await _record_activity(
            session,
            lead_id,
            "lead_updated",
            "user" if actor_user_id is not None else "system",
            actor_user_id,
            {"phone": old_phone},
            {"phone": new_digits},
        )
        await session.commit()

    return await fetch_chat(lead_id)


async def list_lead_activity(chat_id: str, limit: int = 50) -> list[dict]:
    stmt = (
        select(
            LeadActivity.id,
            LeadActivity.event_type,
            LeadActivity.actor_type,
            User.name.label("actor_name"),
            LeadActivity.old_value,
            LeadActivity.new_value,
            LeadActivity.metadata_,
            LeadActivity.created_at,
        )
        .outerjoin(User, User.id == LeadActivity.actor_user_id)
        .where(LeadActivity.lead_id == chat_id)
        .order_by(LeadActivity.created_at.desc(), LeadActivity.id.desc())
        .limit(limit)
    )
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [
        {
            "id": row["id"],
            "event_type": row["event_type"],
            "actor_type": row["actor_type"],
            "actor_name": row["actor_name"],
            "old_value": row["old_value"],
            "new_value": row["new_value"],
            "metadata": row["metadata_"],
            "created_at": _fmt_ts(row["created_at"]),
        }
        for row in rows
    ]
