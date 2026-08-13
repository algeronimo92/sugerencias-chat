"""Fusión de dos leads que son la misma persona.

Existe por el direccionamiento por LID de WhatsApp: los mensajes entrantes
llegan identificados solo con un ``@lid`` y sin el teléfono, así que crean un
lead provisional; los salientes van dirigidos al JID telefónico y usan otro. La
misma conversación termina partida en dos fichas, una con el historial del
cliente y otra con el teléfono y los datos comerciales.

``services.whatsapp_identity_service.learn_send_aliases`` evita que sigan
apareciendo pares nuevos, pero no puede unir los que ya existen: un envío no
debe decidir por su cuenta que dos historiales son de la misma persona. Eso se
resuelve acá, explícitamente y sobre un par ya verificado.

Todo el movimiento va en una sola transacción: o el lead queda entero en el
destino, o no se movió nada. Un merge a medias dejaría mensajes sin ficha.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone

from sqlalchemy import delete, insert, select, update

from db.models import (
    AutomationExecution,
    Lead,
    LeadActivity,
    LeadNote,
    LeadTagAssignment,
    LeadTask,
    MessageOutbox,
    ScheduledMessage,
    UserNotification,
    WhatsAppIdentity,
    WspMessage,
)
from db.session import get_sessionmaker

logger = logging.getLogger(__name__)


class LeadMergeError(RuntimeError):
    pass


# Todo lo que cuelga de un lead, con la columna que lo apunta. Si alguna vez se
# agrega una tabla nueva con FK a leads.id hay que sumarla acá: lo que falte en
# esta lista se pierde al borrar el lead de origen (las FK son ON DELETE
# CASCADE), y ese borrado es justamente el último paso de la fusión.
_OWNED_BY_LEAD = (
    (WspMessage, WspMessage.chat_id),
    (MessageOutbox, MessageOutbox.chat_id),
    (ScheduledMessage, ScheduledMessage.lead_id),
    (LeadActivity, LeadActivity.lead_id),
    (LeadNote, LeadNote.lead_id),
    (LeadTask, LeadTask.lead_id),
    (UserNotification, UserNotification.lead_id),
    (AutomationExecution, AutomationExecution.lead_id),
)

# Campos que el destino adopta del origen solo si los tiene vacíos. El lead
# provisional suele ser el único que trae el pushName del cliente, y el
# telefónico el único con el número: la fusión junta las dos mitades sin pisar
# nada que ya haya cargado un vendedor.
_FILL_IF_EMPTY = (
    "nombre",
    "telefono",
    "servicio_interes",
    "notas",
    "origen",
    "vendedor_id",
    "vendedor",
)


@dataclass
class MergeReport:
    source_id: str
    target_id: str
    moved: dict[str, int] = field(default_factory=dict)
    aliases: tuple[str, ...] = ()
    filled: tuple[str, ...] = ()
    applied: bool = False

    def summary(self) -> str:
        movidos = ", ".join(f"{tabla}={cantidad}" for tabla, cantidad in self.moved.items())
        return (
            f"{self.source_id} -> {self.target_id} "
            f"[{'aplicado' if self.applied else 'simulacion'}] "
            f"alias={list(self.aliases)} campos={list(self.filled)} {movidos}"
        )


async def merge_leads(source_id: str, target_id: str, apply: bool = False) -> MergeReport:
    """Mueve todo lo del lead ``source_id`` al ``target_id`` y borra el origen.

    Con ``apply=False`` (por defecto) cuenta lo que movería y revierte: es la
    simulación que permite revisar un par antes de tocar datos reales.

    El destino conserva su identidad y su etapa comercial; del origen se adopta
    únicamente lo que el destino tenga vacío.
    """
    if source_id == target_id:
        raise LeadMergeError("El origen y el destino son el mismo lead")

    report = MergeReport(source_id=source_id, target_id=target_id)

    async with get_sessionmaker()() as session:
        # Sin session.begin(): la transacción se cierra a mano para poder
        # revertirla íntegra en modo simulación.
        source = await session.get(Lead, source_id, with_for_update=True)
        if source is None:
            raise LeadMergeError(f"El lead de origen {source_id} no existe")
        target = await session.get(Lead, target_id, with_for_update=True)
        if target is None:
            raise LeadMergeError(f"El lead de destino {target_id} no existe")

        try:
            report.aliases = await _move_aliases(session, source_id, target_id)
            report.moved = await _move_owned_rows(session, source_id, target_id)
            report.moved["lead_tag_assignments"] = await _move_tags(
                session, source_id, target_id
            )
            report.filled = _fill_empty_fields(source, target)

            await session.execute(
                insert(LeadActivity).values(
                    lead_id=target_id,
                    event_type="lead_updated",
                    actor_type="system",
                    metadata_={
                        "reason": "merge_lid_duplicate",
                        "merged_from": source_id,
                        "aliases": list(report.aliases),
                        "moved": report.moved,
                    },
                    created_at=datetime.now(timezone.utc),
                )
            )

            # El origen ya no apunta a nada propio: las FK en CASCADE no tienen
            # filas que arrastrar.
            await session.delete(source)
            await session.flush()

            if apply:
                await session.commit()
                report.applied = True
                logger.info("Leads fusionados: %s", report.summary())
            else:
                await session.rollback()
        except Exception:
            await session.rollback()
            raise

    return report


async def _move_aliases(session, source_id: str, target_id: str) -> tuple[str, ...]:
    """Reapunta los JID del origen al destino, sin duplicar los que ya tiene.

    El índice único es (instance, jid), así que un mismo JID registrado con dos
    instancias distintas convive en las dos fichas. Al fusionar, esas copias
    sobran: se descartan las del origen y se conservan las del destino.
    """
    ya_en_destino = set(
        (
            await session.execute(
                select(WhatsAppIdentity.jid).where(WhatsAppIdentity.lead_id == target_id)
            )
        ).scalars().all()
    )
    del_origen = (
        await session.execute(
            select(WhatsAppIdentity.id, WhatsAppIdentity.jid).where(
                WhatsAppIdentity.lead_id == source_id
            )
        )
    ).all()

    movidos: list[str] = []
    repetidos: list[int] = []
    for alias_id, jid in del_origen:
        if jid in ya_en_destino:
            repetidos.append(alias_id)
        else:
            movidos.append(jid)

    if repetidos:
        await session.execute(
            delete(WhatsAppIdentity).where(WhatsAppIdentity.id.in_(repetidos))
        )
    if movidos:
        await session.execute(
            update(WhatsAppIdentity)
            .where(WhatsAppIdentity.lead_id == source_id)
            .values(lead_id=target_id, updated_at=datetime.now(timezone.utc))
        )
    return tuple(movidos)


async def _move_owned_rows(session, source_id: str, target_id: str) -> dict[str, int]:
    """Reapunta al destino cada tabla que cuelga del lead."""
    movidos: dict[str, int] = {}
    for model, column in _OWNED_BY_LEAD:
        result = await session.execute(
            update(model).where(column == source_id).values({column.key: target_id})
        )
        movidos[model.__tablename__] = result.rowcount or 0
    return movidos


async def _move_tags(session, source_id: str, target_id: str) -> int:
    """Mueve las etiquetas, salteando las que el destino ya tiene.

    La clave primaria es (lead_id, tag_id): reapuntar una etiqueta repetida
    haría fallar toda la fusión por un dato que no aporta nada.
    """
    ya_en_destino = set(
        (
            await session.execute(
                select(LeadTagAssignment.tag_id).where(
                    LeadTagAssignment.lead_id == target_id
                )
            )
        ).scalars().all()
    )
    if ya_en_destino:
        await session.execute(
            delete(LeadTagAssignment).where(
                LeadTagAssignment.lead_id == source_id,
                LeadTagAssignment.tag_id.in_(ya_en_destino),
            )
        )
    result = await session.execute(
        update(LeadTagAssignment)
        .where(LeadTagAssignment.lead_id == source_id)
        .values(lead_id=target_id)
    )
    return result.rowcount or 0


def _fill_empty_fields(source: Lead, target: Lead) -> tuple[str, ...]:
    completados: list[str] = []
    for campo in _FILL_IF_EMPTY:
        if getattr(target, campo, None) or not getattr(source, campo, None):
            continue
        setattr(target, campo, getattr(source, campo))
        completados.append(campo)
    if completados:
        target.updated_at = datetime.now(timezone.utc)
    return tuple(completados)
