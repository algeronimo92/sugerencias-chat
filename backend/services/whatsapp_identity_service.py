"""Resolución de identidades LID/teléfono de WhatsApp.

Evolution/Baileys no siempre entrega el mismo JID para una persona. Este módulo
convierte todos los JID disponibles en alias de un único ``leads.id``.
No intenta interpretar los dígitos de un LID como teléfono.
"""

from __future__ import annotations

import logging
import re
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import exists, func, select
from sqlalchemy.exc import IntegrityError

from db.models import Lead, WhatsAppIdentity
from db.session import get_sessionmaker
from services.lead_assignment import pick_next_vendedor_id
from services.settings_service import get_effective


logger = logging.getLogger(__name__)

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
    # En eventos salientes Evolution suele usar el nombre de la propia cuenta
    # ("Você", "DermicaPro", etc.). Nunca debe convertirse en el nombre del
    # contacto. pushName solo es confiable cuando el mensaje viene del cliente.
    from_me = key.get("fromMe") is True
    push_name = None if from_me else (str(data.get("pushName") or "").strip() or None)
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
                        WhatsAppIdentity.instance.in_((identity.instance, "*")),
                        WhatsAppIdentity.jid.in_(identity.jids),
                    )
                    .with_for_update()
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
                    # Una FK válida hace este caso imposible; se conserva el
                    # error explícito para detectar corrupción de datos.
                    raise WhatsAppIdentityConflictError(lead_ids)
            else:
                # remote_jid queda únicamente como puente temporal para una
                # versión antigua de n8n. La identidad real nace en Lead.id.
                legacy_jid = identity.phone_jid or identity.lid_jid
                if legacy_jid is None:
                    raise InvalidWhatsAppIdentityError("No se pudo elegir un JID canónico")

                vendedor_id = None
                if (await get_effective("auto_assign_leads_enabled")) == "true":
                    # Serializa la asignación entre leads nuevos concurrentes:
                    # sin este lock, dos altas en paralelo podrían leer el
                    # mismo "último asignado" y caer en el mismo vendedor.
                    await session.execute(
                        select(
                            func.pg_advisory_xact_lock(
                                func.hashtextextended("lead_round_robin_assignment", 0)
                            )
                        )
                    )
                    vendedor_id = await pick_next_vendedor_id(session)

                lead = Lead(
                    legacy_remote_jid=legacy_jid,
                    telefono=_phone_from_jid(identity.phone_jid),
                    nombre=identity.push_name,
                    vendedor_id=vendedor_id,
                    created_at=now,
                    updated_at=now,
                )
                session.add(lead)
                await session.flush()
                chat_id = lead.id
                lead_created = True

            phone = _phone_from_jid(identity.phone_jid)
            bogus_lid_phone = (
                bool(lead.legacy_remote_jid)
                and lead.legacy_remote_jid.endswith(LID_SUFFIX)
                and lead.telefono is not None
                and re.sub(r"\D", "", lead.telefono)
                == lead.legacy_remote_jid.removesuffix(LID_SUFFIX)
            )
            if phone and (not lead.telefono or bogus_lid_phone):
                lead.telefono = phone
                lead.updated_at = now
            if identity.push_name and not lead.nombre:
                lead.nombre = identity.push_name
                lead.updated_at = now

            known_aliases = {(alias.instance, alias.jid) for alias in aliases}
            for jid in identity.jids:
                if (identity.instance, jid) not in known_aliases:
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
                        WhatsAppIdentity.instance.in_((identity.instance, "*")),
                        WhatsAppIdentity.lead_id == chat_id,
                        WhatsAppIdentity.kind == "phone",
                    )
                    .order_by(WhatsAppIdentity.updated_at.desc())
                    .limit(1)
                )
            send_jid = send_jid or identity.lid_jid or identity.jids[0]

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
    """Devuelve el mejor JID conocido para enviar a un lead interno."""
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
        if phone_jid:
            return phone_jid
        any_jid = await session.scalar(
            select(WhatsAppIdentity.jid)
            .where(WhatsAppIdentity.lead_id == chat_id)
            .order_by(WhatsAppIdentity.updated_at.desc())
            .limit(1)
        )
    if any_jid:
        return any_jid
    raise InvalidWhatsAppIdentityError(
        f"El lead {chat_id} no tiene una identidad de WhatsApp asociada"
    )


async def is_known_alias(jid: str) -> bool:
    """Si ese JID ya está asociado a algún lead.

    Sirve para saltear los rescates caros —preguntarle los contactos a
    Evolution— en los mensajes de una conversación que ya tiene ficha, que son
    la enorme mayoría: sin este corte se gasta una llamada HTTP por cada
    mensaje entrante de todo chat direccionado por LID.
    """
    async with get_sessionmaker()() as session:
        return bool(
            await session.scalar(select(exists().where(WhatsAppIdentity.jid == jid)))
        )


async def resolve_history_jid(chat_id: str) -> str:
    """JID bajo el que Evolution indexa los mensajes del chat.

    No siempre coincide con el de envío. Con el direccionamiento por LID,
    WhatsApp guarda toda la conversación bajo el ``@lid`` aunque los envíos se
    dirijan al teléfono, así que pedir el historial por el JID telefónico
    devuelve cero registros con HTTP 200 — indistinguible de un chat sin
    historial. Se prefiere el LID; el teléfono queda de respaldo para los chats
    que nunca fueron direccionados así.
    """
    async with get_sessionmaker()() as session:
        lid_jid = await session.scalar(
            select(WhatsAppIdentity.jid)
            .where(
                WhatsAppIdentity.lead_id == chat_id,
                WhatsAppIdentity.kind == "lid",
            )
            .order_by(WhatsAppIdentity.updated_at.desc())
            .limit(1)
        )
    return lid_jid or await resolve_whatsapp_destination(chat_id)


def aliases_from_send_key(key: Any) -> tuple[str, ...]:
    """JIDs aprovechables de la ``key`` que Evolution devuelve al enviar.

    Es la única fuente que empareja el ``@lid`` de un contacto con su teléfono.
    Con el direccionamiento por LID de WhatsApp, los mensajes entrantes llegan
    solo con ``remoteJid`` en formato ``@lid`` y sin ``remoteJidAlt``, y los
    contactos de Evolution no exponen el número. En cambio, al enviar al JID
    telefónico Baileys resuelve el direccionamiento y responde con el JID real
    del chat en ``remoteJid`` y su equivalente en ``remoteJidAlt``.
    """
    if not isinstance(key, dict):
        return ()
    return _unique([_clean_jid(key.get("remoteJid")), _clean_jid(key.get("remoteJidAlt"))])


async def learn_send_aliases(chat_id: str, response: Any) -> tuple[str, ...]:
    """Registra como alias del lead los JID con los que WhatsApp direccionó el envío.

    Cierra el agujero por el que un mismo contacto termina partido en dos
    leads: el entrante crea uno con el LID y el saliente usa otro con el
    teléfono. Además es lo que permite que el historial se pida con el JID que
    Evolution efectivamente indexa (ver ``evolution_service.find_chat_messages``).

    Solo agrega alias libres. Si el JID ya pertenece a otro lead se deja como
    está y se registra en el log: fusionar dos historiales es una decisión con
    datos de por medio, no algo que deba resolver un envío.

    Devuelve los alias efectivamente aprendidos.
    """
    jids = aliases_from_send_key(response.get("key") if isinstance(response, dict) else None)
    if not jids:
        return ()

    instance = (await get_effective("evolution_instance")).strip() or "*"
    learned: list[str] = []
    try:
        async with get_sessionmaker()() as session:
            async with session.begin():
                owners = dict(
                    (
                        await session.execute(
                            select(WhatsAppIdentity.jid, WhatsAppIdentity.lead_id).where(
                                WhatsAppIdentity.jid.in_(jids)
                            )
                        )
                    ).all()
                )

                for jid in jids:
                    owner = owners.get(jid)
                    if owner == chat_id:
                        continue
                    if owner is not None:
                        logger.warning(
                            "El alias %s ya pertenece al lead %s y no a %s: "
                            "la conversación está duplicada en dos leads",
                            jid, owner, chat_id,
                        )
                        continue
                    session.add(
                        WhatsAppIdentity(
                            instance=instance,
                            jid=jid,
                            kind="phone" if jid.endswith(PHONE_SUFFIX) else "lid",
                            lead_id=chat_id,
                        )
                    )
                    learned.append(jid)

                # Un lead nacido de un LID no tiene teléfono: este envío es la
                # primera vez que se lo conoce. Mismo criterio que _resolve_once.
                phone_jid = next(
                    (jid for jid in learned if jid.endswith(PHONE_SUFFIX)), None
                )
                if phone_jid is not None:
                    lead = await session.get(Lead, chat_id, with_for_update=True)
                    if lead is not None and not lead.telefono:
                        lead.telefono = _phone_from_jid(phone_jid)
                        lead.updated_at = datetime.now(timezone.utc)
    except IntegrityError:
        # Otro worker registró el mismo alias entre el SELECT y el INSERT. El
        # resultado buscado ya está en la base, así que no hay nada que rehacer.
        logger.info("Los alias del envío a %s ya habían sido registrados", chat_id)
        return ()

    return tuple(learned)
