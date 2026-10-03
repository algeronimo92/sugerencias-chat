"""Implementación en PostgreSQL del puerto ``LeadRepository``.

Trabaja siempre sobre la sesión de la unidad de trabajo del caso de uso
(``app.db.uow.current_session``): ninguna de estas operaciones confirma por su
cuenta, así que un comando que mueve la etapa, audita y agenda automatizaciones
lo hace en una sola transacción.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, exists, func, insert, select, true, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.exc import IntegrityError

from app.core.time_format import iso_utc_micros
from app.db.models.auth import User
from app.db.models.catalogs import LeadTag
from app.db.models.leads import Lead as LeadRow, LeadActivity, LeadStage, LeadTagAssignment, WhatsAppIdentity
from app.db.uow import current_session, session_scope
from app.integrations.whatsapp.connection import ANY_CONNECTION
from app.integrations.whatsapp.identity import WA_ID
from app.modules.conversations.ports.latest_message_repository import latest_customer_message
from app.modules.leads.domain.errors import LeadAlreadyExists
from app.modules.leads.domain.lead import ActivityRecord, Lead, TriggerMessage
from app.modules.leads.domain.stage import StageRule
from app.modules.leads.infrastructure.merge import merge_rows
from domain_types import INITIAL_LEAD_STAGE

# Columnas que el agregado siempre necesita para decidir.
_BASE_COLUMNS = ("id", "estado", "razon_perdido", "contador_noshow", "conversacion_version", "telefono")


def _tag_dict(row) -> dict[str, Any]:
    return {"id": row["id"], "name": row["name"], "color": row["color"]}


class SqlLeadRepository:
    async def get_for_update(self, lead_id: str, fields: Iterable[str] = ()) -> Lead | None:
        wanted = [name for name in dict.fromkeys(fields) if name not in _BASE_COLUMNS]
        columns = [getattr(LeadRow, name) for name in (*_BASE_COLUMNS, *wanted)]
        row = (
            await current_session().execute(
                select(*columns).where(LeadRow.id == lead_id).with_for_update()
            )
        ).mappings().first()
        if row is None:
            return None
        return Lead(
            id=str(row["id"]),
            stage=row["estado"],
            lost_reason=row["razon_perdido"],
            no_show_count=row["contador_noshow"] or 0,
            conversation_version=row["conversacion_version"] or 0,
            phone=row["telefono"],
            values={name: row[name] for name in dict.fromkeys(fields)},
        )

    async def add(self, lead: Lead) -> list[int]:
        session = current_session()
        try:
            async with session.begin_nested():
                await session.execute(insert(LeadRow).values(
                    id=lead.id, estado=lead.stage, **lead.changes,
                ))
                await session.execute(insert(WhatsAppIdentity).values(
                    phone_number_id=ANY_CONNECTION, identifier=lead.phone, kind=WA_ID, lead_id=lead.id,
                ))
        except IntegrityError as exc:
            raise LeadAlreadyExists(lead.phone) from exc
        lead.changes.clear()
        return await self._flush_activities(lead)

    async def save(self, lead: Lead) -> list[int]:
        if lead.changes:
            await current_session().execute(
                update(LeadRow).where(LeadRow.id == lead.id).values(**lead.changes)
            )
            lead.changes.clear()
        return await self._flush_activities(lead)

    async def _flush_activities(self, lead: Lead) -> list[int]:
        ids = [await self.record_activity(lead.id, record) for record in lead.activities]
        lead.activities.clear()
        return ids

    async def record_activity(self, lead_id: str, record: ActivityRecord) -> int:
        return (
            await current_session().execute(
                insert(LeadActivity).values(
                    lead_id=lead_id,
                    event_type=record.event_type,
                    actor_type=record.actor.type,
                    actor_user_id=record.actor.user_id,
                    old_value=record.old_value,
                    new_value=record.new_value,
                    metadata_=record.metadata,
                    created_at=datetime.now(timezone.utc),
                ).returning(LeadActivity.id)
            )
        ).scalar_one()

    async def delete(self, lead_id: str) -> bool:
        session = current_session()
        lead = await session.get(LeadRow, lead_id)
        if lead is None:
            return False
        await session.delete(lead)
        await session.flush()
        return True

    async def stage_rules(self, keys: Iterable[str]) -> dict[str, StageRule]:
        wanted = {key for key in keys if key}
        if not wanted:
            return {}
        rows = (
            await current_session().execute(
                select(LeadStage.key, LeadStage.kind, LeadStage.is_active).where(LeadStage.key.in_(wanted))
            )
        ).all()
        return {key: StageRule(key, kind, bool(is_active)) for key, kind, is_active in rows}

    async def seller_name(self, seller_id: int) -> str | None:
        seller = await current_session().get(User, seller_id)
        if seller is None or not seller.is_active:
            return None
        return seller.name

    async def latest_customer_message(self, lead_id: str) -> TriggerMessage | None:
        message = await latest_customer_message(lead_id)
        if message is None:
            return None
        return TriggerMessage(message["id"], message["content"], iso_utc_micros(message["sent_at"]))

    async def replace_phone_identity(self, lead_id: str, new_phone: str) -> None:
        session = current_session()
        collision = await session.scalar(select(exists().where(
            WhatsAppIdentity.kind == WA_ID,
            WhatsAppIdentity.identifier == new_phone,
            WhatsAppIdentity.lead_id != lead_id,
        )))
        if collision:
            raise LeadAlreadyExists(new_phone)
        aliases = (await session.execute(select(WhatsAppIdentity).where(
            WhatsAppIdentity.lead_id == lead_id,
            WhatsAppIdentity.kind == WA_ID,
        ).with_for_update())).scalars().all()
        if aliases:
            keep, *rest = aliases
            keep.identifier = new_phone
            keep.updated_at = datetime.now(timezone.utc)
            for alias in rest:
                await session.delete(alias)
        else:
            session.add(WhatsAppIdentity(
                phone_number_id=ANY_CONNECTION, identifier=new_phone, kind=WA_ID, lead_id=lead_id,
            ))
        await session.flush()

    async def active_tag(self, tag_id: int) -> dict[str, Any] | None:
        row = (
            await current_session().execute(
                select(LeadTag.id, LeadTag.name, LeadTag.color).where(
                    LeadTag.id == tag_id, LeadTag.is_active == true()
                )
            )
        ).mappings().first()
        return _tag_dict(row) if row is not None else None

    async def assigned_tag(self, lead_id: str, tag_id: int) -> dict[str, Any] | None:
        row = (
            await current_session().execute(
                select(LeadTag.id, LeadTag.name, LeadTag.color)
                .join(LeadTagAssignment, LeadTagAssignment.tag_id == LeadTag.id)
                .where(LeadTagAssignment.lead_id == lead_id, LeadTag.id == tag_id)
            )
        ).mappings().first()
        return _tag_dict(row) if row is not None else None

    async def add_tag(self, lead_id: str, tag_id: int, assigned_by: int | None) -> None:
        await current_session().execute(
            insert(LeadTagAssignment).values(
                lead_id=lead_id, tag_id=tag_id, assigned_by=assigned_by,
                assigned_at=datetime.now(timezone.utc),
            )
        )

    async def remove_tag(self, lead_id: str, tag_id: int) -> None:
        await current_session().execute(
            delete(LeadTagAssignment).where(
                LeadTagAssignment.lead_id == lead_id, LeadTagAssignment.tag_id == tag_id,
            )
        )

    async def open_conversation(self, lead_id: str) -> tuple[int, str | None] | None:
        now = datetime.now(timezone.utc)
        # El WHERE sobre conversacion_abierta hace que dos webhooks
        # concurrentes no puedan abrir dos conversaciones.
        row = (
            await current_session().execute(
                update(LeadRow)
                .where(LeadRow.id == lead_id, LeadRow.conversacion_abierta.is_(False))
                .values(
                    conversacion_abierta=True,
                    conversacion_abierta_at=now,
                    conversacion_cerrada_at=None,
                    conversacion_version=LeadRow.conversacion_version + 1,
                    updated_at=now,
                )
                .returning(LeadRow.conversacion_version, LeadRow.conversacion_abierta_at)
            )
        ).mappings().first()
        if row is None:
            return None
        return int(row["conversacion_version"]), iso_utc_micros(row["conversacion_abierta_at"])

    async def merge(self, source_id: str, target_id: str) -> None:
        await merge_rows(current_session(), source_id, target_id)

    async def rename_service(self, old_name: str, new_name: str) -> list[str]:
        session = current_session()
        matches = func.lower(func.btrim(LeadRow.servicio_interes)) == old_name.lower()
        lead_ids = (await session.execute(select(LeadRow.id).where(matches))).scalars().all()
        if lead_ids:
            await session.execute(
                update(LeadRow).where(matches).values(
                    servicio_interes=new_name, updated_at=datetime.now(timezone.utc),
                )
            )
        return [str(lead_id) for lead_id in lead_ids]


async def ensure_lead_stub(chat_id: str, ultimo_mensaje_at: datetime | None, origen: str | None) -> None:
    """Alta idempotente de un lead mínimo para un mensaje entrante nuevo
    (``INSERT ... ON CONFLICT DO NOTHING``): no pisa un lead existente."""
    async with session_scope() as session:
        await session.execute(
            pg_insert(LeadRow)
            .values(
                id=chat_id, estado=INITIAL_LEAD_STAGE, origen=origen, conversacion_version=0,
                ultimo_mensaje_at=ultimo_mensaje_at,
            )
            .on_conflict_do_nothing(index_elements=[LeadRow.id])
        )
