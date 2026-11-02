"""Identidad de un contacto de WhatsApp con los valores exactos de Meta.

Meta identifica a la persona con ``wa_id`` (su teléfono) y, desde que existen
los nombres de usuario, con ``user_id`` (identificador por negocio). Cualquiera
de los dos puede faltar: un contacto con nombre de usuario activo puede llegar
sin teléfono. Este módulo guarda ambos como alias de un único ``leads.id`` y
nunca deriva uno del otro.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import and_, func, or_, select
from sqlalchemy.exc import IntegrityError

from app.db.models.leads import Lead, WhatsAppIdentity
from app.modules.leads.ports.assignment import (pick_next_vendedor_id)
from app.modules.platform.ports.settings_service import (get_effective)
from app.integrations.whatsapp.connection import ANY_CONNECTION
from app.db.uow import session_scope, unit_of_work


logger = logging.getLogger(__name__)

WA_ID = "wa_id"
USER_ID = "user_id"


class InvalidWhatsAppIdentityError(ValueError):
    pass


class WhatsAppIdentityConflictError(RuntimeError):
    """Los identificadores recibidos ya apuntan a dos leads distintos.

    Se detiene el procesamiento en vez de mezclar historiales automáticamente.
    """

    def __init__(self, lead_ids: set[str]):
        self.lead_ids = sorted(lead_ids)
        super().__init__(f"Los identificadores ya pertenecen a leads distintos: {self.lead_ids}")


def _clean(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    return value.strip() or None


@dataclass(frozen=True)
class ContactIdentity:
    """Quién es el contacto según un evento de Meta.

    ``profile_name`` y ``username`` solo se completan con datos del propio
    contacto (``value.contacts[].profile``), nunca con los del negocio.
    """

    phone_number_id: str
    wa_id: str | None
    user_id: str | None
    profile_name: str | None = None
    username: str | None = None

    def __post_init__(self) -> None:
        if not self.wa_id and not self.user_id:
            raise InvalidWhatsAppIdentityError("El evento no trae wa_id ni user_id del contacto")

    def aliases(self) -> list[tuple[str, str]]:
        values = [(WA_ID, self.wa_id), (USER_ID, self.user_id)]
        return [(kind, value) for kind, value in values if value]


def _matching_contact(contacts: list[Any], wa_id: str | None, user_id: str | None) -> dict:
    for contact in contacts:
        if not isinstance(contact, dict):
            continue
        if (wa_id and _clean(contact.get("wa_id")) == wa_id) or (
            user_id and _clean(contact.get("user_id")) == user_id
        ):
            return contact
    return {}


def identity_from_inbound(phone_number_id: str, message: dict, contacts: list[Any]) -> ContactIdentity:
    """Remitente de ``value.messages[]``: ``from`` y ``from_user_id``."""
    wa_id = _clean(message.get("from"))
    user_id = _clean(message.get("from_user_id"))
    contact = _matching_contact(contacts, wa_id, user_id)
    profile = contact.get("profile") if isinstance(contact.get("profile"), dict) else {}
    return ContactIdentity(
        phone_number_id=phone_number_id,
        wa_id=wa_id or _clean(contact.get("wa_id")),
        user_id=user_id or _clean(contact.get("user_id")),
        profile_name=_clean(profile.get("name")),
        username=_clean(profile.get("username")),
    )


def identity_from_echo(phone_number_id: str, message: dict) -> ContactIdentity:
    """Destinatario de ``value.message_echoes[]``: lo que el negocio mandó
    desde la app de WhatsApp Business. El perfil no es del contacto."""
    return ContactIdentity(
        phone_number_id=phone_number_id,
        wa_id=_clean(message.get("to")),
        user_id=_clean(message.get("to_user_id")),
    )


@dataclass(frozen=True)
class ResolvedIdentity:
    chat_id: str
    lead_created: bool


def _display_username(username: str | None) -> str | None:
    # nombre_usuario es un dato de presentación del lead: se muestra con '@'.
    return "@" + username.lstrip("@") if username else None


def _alias_filter(identity: ContactIdentity):
    return or_(*(
        and_(WhatsAppIdentity.kind == kind, WhatsAppIdentity.identifier == value)
        for kind, value in identity.aliases()
    ))


async def _resolve_once(identity: ContactIdentity, *, create: bool) -> ResolvedIdentity | None:
    now = datetime.now(timezone.utc)
    # Se lee antes de abrir la transacción: no tiene sentido tener tomado el
    # lock del contacto mientras se consulta la configuración.
    auto_assign = create and (await get_effective("auto_assign_leads_enabled")) == "true"
    # Unidad de trabajo y no una sesión suelta: el reparto de vendedor lee en
    # esta misma transacción, la que tiene tomados los locks.
    async with unit_of_work() as uow:
        session = uow.session
        # Serializa eventos que comparten algún identificador. El UNIQUE
        # sigue siendo la última defensa frente a carreras entre workers.
        lock_key = "|".join(sorted(f"{kind}:{value}" for kind, value in identity.aliases()))
        await session.execute(
            select(func.pg_advisory_xact_lock(func.hashtextextended(lock_key, 0)))
        )
        aliases = (
            await session.execute(
                select(WhatsAppIdentity).where(_alias_filter(identity)).with_for_update()
            )
        ).scalars().all()

        lead_ids = {alias.lead_id for alias in aliases}
        if len(lead_ids) > 1:
            raise WhatsAppIdentityConflictError(lead_ids)

        lead_created = False
        if lead_ids:
            chat_id = next(iter(lead_ids))
            lead = await session.get(Lead, chat_id, with_for_update=True)
            if lead is None:
                raise WhatsAppIdentityConflictError(lead_ids)
        else:
            if not create:
                return None
            vendedor_id = None
            if auto_assign:
                # Serializa la asignación entre leads nuevos concurrentes.
                await session.execute(
                    select(func.pg_advisory_xact_lock(
                        func.hashtextextended("lead_round_robin_assignment", 0)
                    ))
                )
                vendedor_id = await pick_next_vendedor_id()
            lead = Lead(
                telefono=identity.wa_id,
                nombre=identity.profile_name,
                nombre_usuario=_display_username(identity.username),
                vendedor_id=vendedor_id,
                created_at=now,
                updated_at=now,
            )
            session.add(lead)
            await session.flush()
            chat_id = lead.id
            lead_created = True

        if identity.wa_id and not lead.telefono:
            lead.telefono = identity.wa_id
            lead.updated_at = now
        if identity.profile_name and not lead.nombre:
            lead.nombre = identity.profile_name
            lead.updated_at = now
        username = _display_username(identity.username)
        if username and not lead.nombre_usuario:
            lead.nombre_usuario = username
            lead.updated_at = now

        known = {(alias.kind, alias.identifier): alias for alias in aliases}
        for kind, value in identity.aliases():
            existing = known.get((kind, value))
            if existing is None:
                session.add(WhatsAppIdentity(
                    phone_number_id=identity.phone_number_id,
                    identifier=value,
                    kind=kind,
                    lead_id=chat_id,
                ))
            elif existing.phone_number_id == ANY_CONNECTION:
                # Alias creado a mano sin número conocido: el primer evento
                # de Meta dice por cuál llega.
                existing.phone_number_id = identity.phone_number_id
                existing.updated_at = now
        await session.flush()

        return ResolvedIdentity(chat_id=chat_id, lead_created=lead_created)


async def resolve_whatsapp_identity(identity: ContactIdentity, *, create: bool = True) -> ResolvedIdentity | None:
    """Lead dueño de la identidad; lo crea si no existe y ``create`` lo pide.

    Registra los identificadores que falten. Reintenta una vez si otro worker
    insertó el mismo alias entre el SELECT y el INSERT.
    """
    try:
        return await _resolve_once(identity, create=create)
    except IntegrityError:
        return await _resolve_once(identity, create=create)


@dataclass(frozen=True)
class Destination:
    wa_id: str | None
    user_id: str | None


async def resolve_whatsapp_destination(chat_id: str) -> Destination:
    """Identificadores conocidos para escribirle a un lead.

    Se prefieren los más recientes: un contacto que cambió de número llega
    con su ``wa_id`` nuevo y ese es el que sirve.
    """
    async with session_scope() as session:
        rows = (
            await session.execute(
                select(WhatsAppIdentity.kind, WhatsAppIdentity.identifier)
                .where(WhatsAppIdentity.lead_id == chat_id)
                .order_by(WhatsAppIdentity.updated_at.desc(), WhatsAppIdentity.id.desc())
            )
        ).all()
    values: dict[str, str] = {}
    for kind, identifier in rows:
        values.setdefault(kind, identifier)
    if not values:
        raise InvalidWhatsAppIdentityError(
            f"El lead {chat_id} no tiene una identidad de WhatsApp asociada"
        )
    return Destination(wa_id=values.get(WA_ID), user_id=values.get(USER_ID))


async def lead_id_for_identifier(identifier: str) -> str | None:
    """Lead dueño de un ``wa_id`` o ``user_id``, o None si no está registrado."""
    async with session_scope() as session:
        return await session.scalar(
            select(WhatsAppIdentity.lead_id)
            .where(WhatsAppIdentity.identifier == identifier)
            .limit(1)
        )


async def add_identity_alias(chat_id: str, phone_number_id: str, kind: str, identifier: str) -> bool:
    """Suma un identificador que Meta informó para un lead ya conocido.

    Lo usan el aviso de cambio de número (``system.new_wa_id``) y la respuesta
    de un envío (``contacts[].wa_id``). Si el identificador ya es de otro lead
    no se toca: fusionar historiales es una decisión con datos de por medio.
    """
    identifier = _clean(identifier)
    if identifier is None or kind not in {WA_ID, USER_ID}:
        return False
    try:
        async with session_scope() as session:
            owner = await session.scalar(
                select(WhatsAppIdentity.lead_id).where(
                    WhatsAppIdentity.kind == kind,
                    WhatsAppIdentity.identifier == identifier,
                )
            )
            if owner == chat_id:
                return False
            if owner is not None:
                logger.warning(
                    "El %s %s ya pertenece al lead %s y no a %s",
                    kind, identifier, owner, chat_id,
                )
                return False
            session.add(WhatsAppIdentity(
                phone_number_id=phone_number_id or ANY_CONNECTION,
                identifier=identifier,
                kind=kind,
                lead_id=chat_id,
            ))
    except IntegrityError:
        return False
    return True
