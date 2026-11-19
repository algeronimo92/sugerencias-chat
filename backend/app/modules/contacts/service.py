"""Comandos de la agenda: alta, edición, borrado, etiquetas y paso al embudo.

Cada uno corre en su unidad de trabajo y avisa con ``ContactsChanged`` una
vez confirmado."""

from __future__ import annotations

from datetime import datetime, timezone

from app.core.errors import DomainError
from app.core.phone_utils import PhoneValidationError, normalize_phone
from app.db.uow import collect, unit_of_work
from app.modules.contacts import repository
from app.modules.contacts.errors import (
    ContactAlreadyExists, ContactNotFound, ContactWithoutPhone, InvalidContact,
)
from app.modules.contacts.events import ContactsChanged
from app.modules.contacts.normalization import clean_text, merge_tags, parse_tags
from app.modules.contacts.queries import get_contact
from app.modules.contacts.types import ContactOrigin
from app.modules.leads.public import Actor, create_lead, fetch_lead_raw, lead_ids_for_contacts
from app.modules.platform.public import effective_country_code

# Textos libres que se editan desde la ficha.
_TEXT_FIELDS = {"nombre": 200, "email": 200, "notas": 2000}


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def _phone(raw: str) -> str:
    try:
        return normalize_phone(raw, await effective_country_code())
    except PhoneValidationError as exc:
        raise InvalidContact(str(exc)) from exc


def _consent_values(consent: bool) -> dict:
    return {"consentimiento_marketing": consent, "consentimiento_at": _now() if consent else None}


async def link_leads(contacts: list[dict]) -> None:
    """Enlaza cada contacto sin lead con el lead que usa su número o BSUID."""
    pending = [contact for contact in contacts if not contact.get("lead_id")]
    if not pending:
        return
    found = await lead_ids_for_contacts(
        [contact["telefono"] for contact in pending if contact.get("telefono")],
        [contact["wa_user_id"] for contact in pending if contact.get("wa_user_id")],
    )
    pairs = [
        (str(contact["id"]), lead_id)
        for contact in pending
        if (lead_id := found.get(contact.get("telefono") or "") or found.get(contact.get("wa_user_id") or ""))
    ]
    await repository.link_leads(pairs)


async def create_contact(values: dict, *, user_id: int) -> dict:
    phone = await _phone(values.get("telefono") or "")
    row = {
        field: clean_text(values.get(field), limit) for field, limit in _TEXT_FIELDS.items()
    }
    row.update(
        telefono=phone,
        etiquetas=parse_tags(values.get("etiquetas")),
        origen=ContactOrigin.MANUAL,
        editado_en_crm_at=_now(),
        **_consent_values(bool(values.get("consentimiento_marketing"))),
    )
    async with unit_of_work():
        if await repository.contacts_by_identity([phone], []):
            raise ContactAlreadyExists()
        created = await repository.insert_contacts([row])
        if not created:
            raise ContactAlreadyExists()
        await link_leads(created)
        collect(ContactsChanged())
    return await get_contact(str(created[0]["id"]))


async def update_contact(contact_id: str, values: dict) -> dict:
    changes: dict = {}
    for field, limit in _TEXT_FIELDS.items():
        if field in values:
            changes[field] = clean_text(values[field], limit)
    if "etiquetas" in values:
        changes["etiquetas"] = parse_tags(values["etiquetas"])
    async with unit_of_work():
        current = await repository.contact_row(contact_id, lock=True)
        if current is None:
            raise ContactNotFound()
        if "telefono" in values:
            if values["telefono"]:
                phone = await _phone(values["telefono"])
                if phone != current["telefono"]:
                    clash = await repository.contacts_by_identity([phone], [])
                    if any(str(other["id"]) != contact_id for other in clash):
                        raise ContactAlreadyExists()
                    changes["telefono"] = phone
            elif not current["wa_user_id"]:
                raise InvalidContact("El teléfono es obligatorio")
            else:
                changes["telefono"] = None
        if "consentimiento_marketing" in values and bool(values["consentimiento_marketing"]) != current["consentimiento_marketing"]:
            changes.update(_consent_values(bool(values["consentimiento_marketing"])))
        if changes:
            changes["editado_en_crm_at"] = _now()
            await repository.update_contact(contact_id, changes)
            if "telefono" in changes and changes["telefono"] and not current["lead_id"]:
                await link_leads([{**current, "telefono": changes["telefono"]}])
            collect(ContactsChanged())
    return await get_contact(contact_id)


async def delete_contacts(contact_ids: list[str]) -> int:
    """Borra de la agenda. El lead enlazado, si lo hay, sigue en el embudo."""
    async with unit_of_work():
        deleted = await repository.delete_contacts(contact_ids)
        if deleted:
            collect(ContactsChanged())
    return deleted


async def change_tags(contact_ids: list[str], *, add: list[str], remove: list[str]) -> int:
    add = parse_tags(add)
    removed = {tag.casefold() for tag in parse_tags(remove)}
    async with unit_of_work():
        updates = {}
        for contact in await repository.contacts_by_ids(contact_ids):
            tags = [tag for tag in merge_tags(contact["etiquetas"], add) if tag.casefold() not in removed]
            if tags != list(contact["etiquetas"] or []):
                updates[str(contact["id"])] = {"etiquetas": tags, "editado_en_crm_at": _now()}
        await repository.update_contacts(updates)
        if updates:
            collect(ContactsChanged())
    return len(updates)


async def promote_to_lead(contact_id: str, *, user_id: int) -> str:
    """Pasa el contacto al embudo: crea su lead (con las automatizaciones de
    lead nuevo) o lo enlaza con el que ya usa su número."""
    async with unit_of_work():
        contact = await repository.contact_row(contact_id, lock=True)
        if contact is None:
            raise ContactNotFound()
        if contact["lead_id"]:
            return str(contact["lead_id"])
        if not contact["telefono"]:
            raise ContactWithoutPhone()
        found = await lead_ids_for_contacts([contact["telefono"]], [contact["wa_user_id"]] if contact["wa_user_id"] else [])
        lead_id = found.get(contact["telefono"]) or found.get(contact["wa_user_id"] or "")
        if lead_id is None:
            lead_id = await create_lead(
                contact["telefono"],
                contact["nombre"] or contact["telefono"],
                actor=Actor.user(user_id),
                origen="contactos",
                notas=contact["notas"],
            )
        await repository.update_contact(contact_id, {"lead_id": lead_id})
        collect(ContactsChanged())
    return str(lead_id)


async def ensure_contact_for_lead(lead_id: str) -> None:
    """Quien escribe o se registra como lead también queda en la agenda."""
    lead = await fetch_lead_raw(lead_id)
    phone = (lead or {}).get("telefono")
    if not phone or not str(phone).isdigit():
        return
    async with unit_of_work():
        existing = await repository.contacts_by_identity([phone], [])
        if existing:
            unlinked = [contact for contact in existing if not contact["lead_id"]]
            await repository.link_leads([(str(contact["id"]), lead_id) for contact in unlinked])
            if unlinked:
                collect(ContactsChanged())
            return
        created = await repository.insert_contacts([{
            "nombre": clean_text((lead or {}).get("nombre"), 200),
            "telefono": phone,
            "origen": ContactOrigin.LEAD,
            "lead_id": lead_id,
        }])
        if created:
            collect(ContactsChanged())


async def promote_many(contact_ids: list[str], *, user_id: int) -> tuple[int, int]:
    """Uno por uno, cada uno en su transacción: un contacto sin número no
    frena a los demás. -> (pasados, fallidos)."""
    promoted = failed = 0
    for contact_id in dict.fromkeys(contact_ids):
        try:
            await promote_to_lead(contact_id, user_id=user_id)
            promoted += 1
        except DomainError:
            failed += 1
    return promoted, failed
