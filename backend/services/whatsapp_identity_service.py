"""Resolución de identidades LID/teléfono de WhatsApp.

Evolution/Baileys no siempre entrega el mismo JID para una persona. Este módulo
convierte todos los JID disponibles en alias de un único ``leads.remote_jid``.
No intenta interpretar los dígitos de un LID como teléfono.
"""

from __future__ import annotations

import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from db.models import Lead, WhatsAppIdentity
from db.session import get_sessionmaker


PHONE_SUFFIX = "@s.whatsapp.net"
LID_SUFFIX = "@lid"
_VALID_JID = re.compile(r"^[0-9]+@(s\.whatsapp\.net|lid)$")


class InvalidWhatsAppIdentityError(ValueError):
    pass


class WhatsAppIdentityConflictError(RuntimeError):
    """Los alias recibidos ya apuntan a dos leads distintos.

    Se detiene el procesamiento en vez de mezclar historiales automáticamente.
    """

    def __init__(self, lead_ids: set[str]):
        self.lead_ids = sorted(lead_ids)
        super().__init__(f"Los alias ya pertenecen a leads distintos: {self.lead_ids}")


@dataclass(frozen=True)
class ParsedWhatsAppIdentity:
    instance: str
    jids: tuple[str, ...]
    phone_jid: str | None
    lid_jid: str | None
    push_name: str | None


@dataclass(frozen=True)
class ResolvedWhatsAppIdentity:
    chat_id: str
    send_jid: str
    phone: str | None
    phone_jid: str | None
    lid_jid: str | None
    aliases: tuple[str, ...]
    unresolved: bool
    lead_created: bool

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["aliases"] = list(self.aliases)
        return payload


def _clean_jid(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    jid = value.strip().lower()
    return jid if _VALID_JID.fullmatch(jid) else None


def _unique(values: list[str | None]) -> tuple[str, ...]:
    return tuple(dict.fromkeys(value for value in values if value))


def parse_evolution_identity(payload: dict[str, Any]) -> ParsedWhatsAppIdentity:
    """Extrae identidades de un webhook nativo o del item completo de n8n."""
    evolution = payload.get("body") if isinstance(payload.get("body"), dict) else payload
    data = evolution.get("data") if isinstance(evolution.get("data"), dict) else {}
    key = data.get("key") if isinstance(data.get("key"), dict) else {}

    raw_remote_jid = str(key.get("remoteJid") or "").strip().lower()
    if raw_remote_jid.endswith("@g.us") or raw_remote_jid.endswith("@broadcast"):
        raise InvalidWhatsAppIdentityError(
            "El webhook corresponde a un grupo o broadcast, no a un lead individual"
        )

    instance = str(evolution.get("instance") or "").strip()
    if not instance:
        raise InvalidWhatsAppIdentityError("El webhook no contiene 'instance'")

    remote_jid = _clean_jid(key.get("remoteJid"))
    remote_jid_alt = _clean_jid(key.get("remoteJidAlt"))
    participant = _clean_jid(key.get("participant"))
    participant_alt = _clean_jid(key.get("participantAlt"))
    jids = _unique([remote_jid, remote_jid_alt, participant, participant_alt])
    if not jids:
        raise InvalidWhatsAppIdentityError(
            "El webhook no contiene un JID individual compatible"
        )

    phone_jid = next((jid for jid in jids if jid.endswith(PHONE_SUFFIX)), None)
    lid_jid = next((jid for jid in jids if jid.endswith(LID_SUFFIX)), None)
    push_name = str(data.get("pushName") or "").strip() or None
    return ParsedWhatsAppIdentity(instance, jids, phone_jid, lid_jid, push_name)


def add_phone_jid(
    identity: ParsedWhatsAppIdentity, phone_jid: str | None
) -> ParsedWhatsAppIdentity:
    """Añade un teléfono obtenido por una consulta auxiliar a Evolution."""
    clean_phone = _clean_jid(phone_jid)
    if clean_phone is None or not clean_phone.endswith(PHONE_SUFFIX):
        return identity
    return ParsedWhatsAppIdentity(
        instance=identity.instance,
        jids=_unique([*identity.jids, clean_phone]),
        phone_jid=identity.phone_jid or clean_phone,
        lid_jid=identity.lid_jid,
        push_name=identity.push_name,
    )


def _phone_from_jid(phone_jid: str | None) -> str | None:
    return f"+{phone_jid.removesuffix(PHONE_SUFFIX)}" if phone_jid else None


async def _resolve_once(identity: ParsedWhatsAppIdentity) -> ResolvedWhatsAppIdentity:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        async with session.begin():
            # Serializa eventos que ya comparten algún alias. El UNIQUE sigue
            # siendo la última defensa frente a carreras entre workers.
            lock_key = f"{identity.instance}|{'|'.join(sorted(identity.jids))}"
            await session.execute(
                select(func.pg_advisory_xact_lock(func.hashtextextended(lock_key, 0)))
            )

            aliases = (
                await session.execute(
                    select(WhatsAppIdentity)
                    .where(
                        WhatsAppIdentity.instance == identity.instance,
                        WhatsAppIdentity.jid.in_(identity.jids),
                    )
                    .with_for_update()
                )
            ).scalars().all()

            direct_leads = (
                await session.execute(
                    select(Lead).where(Lead.remote_jid.in_(identity.jids)).with_for_update()
                )
            ).scalars().all()
            lead_ids = {alias.lead_id for alias in aliases}
            lead_ids.update(lead.remote_jid for lead in direct_leads)
            if len(lead_ids) > 1:
                raise WhatsAppIdentityConflictError(lead_ids)

            lead_created = False
            if lead_ids:
                chat_id = next(iter(lead_ids))
                lead = await session.get(Lead, chat_id, with_for_update=True)
                if lead is None:
                    # Una FK válida hace este caso imposible; se conserva el
                    # error explícito para detectar corrupción de datos.
                    raise WhatsAppIdentityConflictError(lead_ids)
            else:
                # Si el teléfono está disponible desde el inicio es el mejor
                # chat_id para compatibilidad. Si no, el LID queda provisional.
                chat_id = identity.phone_jid or identity.lid_jid
                if chat_id is None:
                    raise InvalidWhatsAppIdentityError("No se pudo elegir un JID canónico")
                lead = Lead(
                    remote_jid=chat_id,
                    telefono=_phone_from_jid(identity.phone_jid),
                    nombre=identity.push_name,
                    created_at=now,
                    updated_at=now,
                )
                session.add(lead)
                await session.flush()
                lead_created = True

            phone = _phone_from_jid(identity.phone_jid)
            bogus_lid_phone = (
                lead.remote_jid.endswith(LID_SUFFIX)
                and lead.telefono is not None
                and re.sub(r"\D", "", lead.telefono)
                == lead.remote_jid.removesuffix(LID_SUFFIX)
            )
            if phone and (not lead.telefono or bogus_lid_phone):
                lead.telefono = phone
                lead.updated_at = now
            if identity.push_name and not lead.nombre:
                lead.nombre = identity.push_name
                lead.updated_at = now

            known_jids = {alias.jid for alias in aliases}
            for jid in identity.jids:
                if jid not in known_jids:
                    session.add(
                        WhatsAppIdentity(
                            instance=identity.instance,
                            jid=jid,
                            kind="phone" if jid.endswith(PHONE_SUFFIX) else "lid",
                            lead_id=chat_id,
                        )
                    )
            await session.flush()

            send_jid = identity.phone_jid
            if send_jid is None:
                send_jid = await session.scalar(
                    select(WhatsAppIdentity.jid)
                    .where(
                        WhatsAppIdentity.instance == identity.instance,
                        WhatsAppIdentity.lead_id == chat_id,
                        WhatsAppIdentity.kind == "phone",
                    )
                    .order_by(WhatsAppIdentity.updated_at.desc())
                    .limit(1)
                )
            send_jid = send_jid or chat_id

        return ResolvedWhatsAppIdentity(
            chat_id=chat_id,
            send_jid=send_jid,
            phone=phone or lead.telefono,
            phone_jid=identity.phone_jid,
            lid_jid=identity.lid_jid,
            aliases=identity.jids,
            unresolved=identity.phone_jid is None and send_jid.endswith(LID_SUFFIX),
            lead_created=lead_created,
        )


async def resolve_whatsapp_identity(
    identity: ParsedWhatsAppIdentity,
) -> ResolvedWhatsAppIdentity:
    """Resuelve y registra alias; reintenta una carrera de inserción una vez."""
    try:
        return await _resolve_once(identity)
    except IntegrityError:
        # Otro worker pudo crear el lead/alias entre SELECT e INSERT. La
        # transacción anterior ya fue revertida al salir del context manager.
        return await _resolve_once(identity)


async def resolve_whatsapp_destination(chat_id: str) -> str:
    """Devuelve el JID telefónico conocido para enviar, o el chat_id original."""
    if chat_id.endswith(PHONE_SUFFIX):
        return chat_id
    async with get_sessionmaker()() as session:
        phone_jid = await session.scalar(
            select(WhatsAppIdentity.jid)
            .where(
                WhatsAppIdentity.lead_id == chat_id,
                WhatsAppIdentity.kind == "phone",
            )
            .order_by(WhatsAppIdentity.updated_at.desc())
            .limit(1)
        )
    return phone_jid or chat_id
