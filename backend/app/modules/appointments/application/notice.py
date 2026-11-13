"""Los avisos de cita por WhatsApp: cómo los configura el negocio y cómo
salen cuando se guarda una cita.

Al cliente le llega en el chat de su lead (el equipo ve el mensaje en la
conversación). Al equipo (el responsable y los admins) le llega directo a su
número, sin abrir un chat en el CRM: no son leads.

Con un número de avisos elegido (otro número de la WABA del CRM o de otra
WABA del mismo portfolio, con copias de las plantillas) los dos salen
desde ese número y directo al teléfono: el del cliente ya no entra a su chat,
porque el cliente lo recibe de un número distinto al de la conversación.
"""

from __future__ import annotations

import logging
from datetime import datetime

from app.db.uow import collect, unit_of_work
from app.modules.appointments.application.ports import appointment_ports
from app.modules.appointments.domain.events import NoticeTemplatesChanged
from app.modules.appointments.domain.calendar_event import BUILTIN_FIELDS, CUSTOM_PREFIX
from app.modules.appointments.domain.errors import NoticeAccountUnavailable
from app.modules.appointments.domain.notice import (
    FORMATTED_FIELDS,
    LEAD_CUSTOM_PREFIX,
    LEAD_FIELDS,
    Audience,
    InvalidNotice,
    NoticeConfig,
    as_template,
    field_values,
    from_template_parameter,
    parameter_values,
    validate_parameters,
)
from app.modules.catalogs.ports.custom_fields import list_definitions
from app.modules.catalogs.ports.template_service import list_templates
from app.modules.platform.ports.settings_service import get_effective_many, update_settings

logger = logging.getLogger(__name__)

# Phone number id del número de avisos. Vacío: los avisos salen del número
# del CRM, como antes de que existiera.
SENDER_KEY = "appointment_notice_phone_number_id"
# Su WABA cuando no es la del CRM: en coexistencia Meta no deja elegir una
# existente y crea otra en el portfolio del negocio. Ahí los avisos usan
# copias de las plantillas, con el mismo nombre e idioma.
SENDER_ACCOUNT_KEY = "appointment_notice_waba_id"


async def _sender() -> str | None:
    return ((await get_effective_many((SENDER_KEY,)))[SENDER_KEY] or "").strip() or None


def setting_keys(audience: Audience) -> tuple[str, str, str]:
    prefix = f"appointment_{audience.value}_notice"
    return f"{prefix}_enabled", f"{prefix}_template_id", f"{prefix}_parameters"


async def _config(audience: Audience) -> NoticeConfig:
    enabled, template_id, parameters = setting_keys(audience)
    stored = await get_effective_many((enabled, template_id, parameters))
    return NoticeConfig.from_settings(stored[enabled], stored[template_id], stored[parameters])


def _sendable(template: dict, audience: Audience, sender: str | None) -> bool:
    """Solo una plantilla oficial aprobada llega con la ventana de 24 h
    cerrada. Tiene que ser global: el aviso sale a nombre de quien cargó la
    cita, que no ve las plantillas personales de otro. Desde el número del
    CRM al equipo no le llega una con imagen, porque la imagen la sube el
    outbox de los chats; desde el número de avisos la sube el envío mismo."""
    return (
        template["template_type"] == "official"
        and template["official_status"] == "APPROVED"
        and template["visibility"] == "global"
        and bool(template["is_active"])
        and (
            audience is Audience.CLIENT
            or sender is not None
            or template.get("official_header_type") != "image"
        )
    )


def _variable_count(template: dict) -> int:
    return len(template["official_parameter_values"] or [])


async def _template(template_id: int | None, user_id: int, audience: Audience) -> dict | None:
    template = next((item for item in await list_templates(user_id) if item["id"] == template_id), None)
    return template if template is not None and _sendable(template, audience, await _sender()) else None


async def _fields() -> list[dict]:
    """Todo lo que puede ir en un aviso, agrupado como lo ve el armador: la
    cita, sus campos personalizados, el lead y los campos del lead."""
    appointment_custom = await list_definitions("appointment")
    lead_custom = await list_definitions("lead")
    return (
        [{"key": key, "label": label, "group": "cita"} for key, label in BUILTIN_FIELDS.items()]
        + [{"key": key, "label": label, "group": "cita"} for key, label in FORMATTED_FIELDS.items()]
        + [
            {"key": f"{CUSTOM_PREFIX}{item['key']}", "label": item["label"], "group": "cita_personalizado"}
            for item in appointment_custom
            if item["key"] not in BUILTIN_FIELDS
        ]
        + [{"key": key, "label": label, "group": "lead"} for key, label in LEAD_FIELDS.items()]
        + [
            {"key": f"{LEAD_CUSTOM_PREFIX}{item['key']}", "label": item["label"], "group": "lead_personalizado"}
            for item in lead_custom
        ]
    )


async def _preview() -> dict | None:
    """Los valores de la última cita real con su lead, para que el armador
    muestre cómo sale cada variable con datos de verdad y no haya que
    suponerlo."""
    ports = appointment_ports()
    appointment = await ports.repository.latest_real()
    if appointment is None:
        return None
    lead = await ports.leads.snapshot(appointment["lead_id"]) if appointment.get("lead_id") else None
    name = appointment.get("nombre_completo") or "Sin nombre"
    service = appointment.get("tratamiento") or ""
    return {
        "label": f"{name} · {service}" if service else name,
        "values": field_values(appointment, lead),
    }


async def get_settings(audience: Audience, user_id: int) -> dict:
    config = await _config(audience)
    sender = await _sender()
    templates = [
        {
            "id": item["id"], "name": item["name"], "content": item["content"],
            "variable_count": _variable_count(item),
            "suggested_parameters": [
                from_template_parameter(value) for value in item["official_parameter_values"] or []
            ],
        }
        for item in await list_templates(user_id)
        if _sendable(item, audience, sender)
    ]
    return {
        "enabled": config.enabled,
        "template_id": config.template_id,
        "parameters": [as_template(value) for value in config.parameters],
        "fields": await _fields(),
        "templates": templates,
        "preview": await _preview(),
    }


async def save_settings(
    audience: Audience, *, enabled: bool, template_id: int | None, parameters: list[str], user_id: int,
) -> dict:
    """Guarda el aviso. Apagado y sin plantilla se puede guardar; con
    plantilla, exige que sea enviable y que cada variable tenga contenido
    con campos que existan. Levanta
    ``InvalidNotice`` si no."""
    clean: tuple[str, ...] = tuple(parameters)
    if template_id is not None or enabled:
        template = await _template(template_id, user_id, audience)
        if template is None:
            raise InvalidNotice("Elige una plantilla oficial aprobada y visible para todo el equipo")
        known_keys = {item["key"] for item in await _fields()}
        clean = validate_parameters(list(parameters), expected=_variable_count(template), known_keys=known_keys)
    stored = NoticeConfig(enabled=enabled, template_id=template_id, parameters=clean).to_settings()
    enabled_key, template_key, parameters_key = setting_keys(audience)
    await update_settings({
        enabled_key: stored["enabled"],
        template_key: stored["template_id"],
        parameters_key: stored["parameters"],
    })
    return await get_settings(audience, user_id)


async def _appointment(appointment_id: int) -> dict | None:
    """La cita, si es real: una de prueba nunca avisa a nadie."""
    appointment = await appointment_ports().repository.get(appointment_id)
    if appointment is None or appointment.get("test_mode"):
        return None
    return appointment


def _short(error: BaseException) -> str:
    """El motivo de un fallo como se lee en el historial: una línea."""
    text = " ".join(str(error).split()) or type(error).__name__
    return text[:300]


async def send_client_notice(appointment_id: int) -> str:
    """Avisa al cliente de su cita nueva y deja el aviso registrado en la
    cita. Devuelve qué pasó (para el log y los tests): ``sent`` o el motivo
    por el que no salió. Sin lead no sale: el envío va al chat del lead, que
    es donde el equipo ve la conversación."""
    config = await _config(Audience.CLIENT)
    if not config.enabled or config.template_id is None:
        return "disabled"
    appointment = await _appointment(appointment_id)
    if appointment is None:
        return "skipped"
    ports = appointment_ports()
    notice = {
        "audience": Audience.CLIENT.value, "recipient_name": appointment.get("nombre_completo") or "Cliente",
        "phone": appointment.get("telefono") or None, "template_id": config.template_id,
    }
    if not appointment.get("lead_id"):
        await ports.notices.record(appointment_id, [{
            **notice, "status": "skipped", "reason": "La cita no está vinculada a un lead",
        }])
        return "no_lead"
    lead = await ports.leads.snapshot(appointment["lead_id"])
    parameters = parameter_values(appointment, config.parameters, lead)
    sender = await _sender()
    if sender is not None:
        return await _send_client_from(appointment, config.template_id, parameters, sender, notice)
    try:
        message_id = await ports.messenger.send_to_lead(
            chat_id=appointment["lead_id"], template_id=config.template_id,
            parameters=parameters,
            user_id=appointment["created_by_user_id"], dedupe_key=f"appointment-client-notice:{appointment_id}",
        )
    except Exception as exc:
        logger.warning("No se pudo encolar el aviso al cliente de la cita %s", appointment_id, exc_info=True)
        await ports.notices.record(appointment_id, [{**notice, "status": "failed", "reason": _short(exc)}])
        return "failed"
    await ports.notices.record(appointment_id, [{**notice, "status": "sent", "wsp_message_id": message_id}])
    return "sent"


async def _send_client_from(
    appointment: dict, template_id: int, parameters: list[str], sender: str, notice: dict,
) -> str:
    """El aviso al cliente desde el número de avisos: directo a su WhatsApp,
    fuera de su chat. Su estado de entrega se reconoce por el id de Meta."""
    ports = appointment_ports()
    appointment_id = appointment["id"]
    template = await _template(template_id, appointment["created_by_user_id"], Audience.CLIENT)
    if template is None:
        await ports.notices.record(appointment_id, [{
            **notice, "status": "failed", "reason": "La plantilla ya no es una plantilla oficial aprobada y global",
        }])
        return "failed"
    try:
        provider_id = await ports.messenger.send_to_lead_from(
            chat_id=appointment["lead_id"], template=template, parameters=parameters, sender=sender,
        )
    except Exception as exc:
        # Cualquier error, también al leer la imagen del encabezado: el aviso
        # queda registrado como fallido en vez de perderse en el log.
        logger.warning("No se pudo avisar al cliente de la cita %s", appointment_id, exc_info=True)
        await ports.notices.record(appointment_id, [{**notice, "status": "failed", "reason": _short(exc)}])
        return "failed"
    await ports.notices.record(appointment_id, [{**notice, "status": "sent", "provider_message_id": provider_id}])
    return "sent"


async def send_staff_notice(appointment_id: int) -> dict[int, str]:
    """Avisa de la venta al responsable de la cita y a los admins, y deja
    cada aviso registrado en la cita. Devuelve qué pasó con cada uno, por id
    de usuario. Un envío que falla no frena a los demás."""
    config = await _config(Audience.STAFF)
    if not config.enabled or config.template_id is None:
        return {}
    appointment = await _appointment(appointment_id)
    if appointment is None:
        return {}
    template = await _template(config.template_id, appointment["created_by_user_id"], Audience.STAFF)
    if template is None:
        logger.warning("Aviso al equipo de la cita %s sin enviar: la plantilla ya no es enviable", appointment_id)
        return {}
    ports = appointment_ports()
    lead = await ports.leads.snapshot(appointment["lead_id"]) if appointment.get("lead_id") else None
    parameters = parameter_values(appointment, config.parameters, lead)
    sender = await _sender()
    results: dict[int, str] = {}
    notices: list[dict] = []
    for recipient in await ports.staff.recipients(appointment.get("vendedor") or ""):
        notice = {
            "audience": Audience.STAFF.value, "recipient_name": recipient["name"], "user_id": recipient["id"],
            "phone": recipient["phone"], "template_id": config.template_id,
        }
        if not recipient["phone"]:
            notices.append({**notice, "status": "skipped", "reason": "Sin WhatsApp cargado en Usuarios"})
            results[recipient["id"]] = "skipped"
            continue
        try:
            provider_id = await ports.messenger.send_to_phone(
                phone=recipient["phone"], template=template, parameters=parameters, sender=sender,
            )
            notices.append({**notice, "status": "sent", "provider_message_id": provider_id})
            results[recipient["id"]] = "sent"
        except Exception as exc:
            # Cualquier error, no solo los esperados: en la cita 359 uno
            # inesperado con el primer destinatario cortó el envío y el resto
            # del equipo se quedó sin aviso.
            logger.warning(
                "No se pudo avisar al usuario %s de la cita %s", recipient["id"], appointment_id, exc_info=True,
            )
            notices.append({**notice, "status": "failed", "reason": _short(exc)})
            results[recipient["id"]] = "failed"
    if notices:
        await ports.notices.record(appointment_id, notices)
    return results


async def _sender_account() -> str | None:
    """La WABA propia del número de avisos; ``None`` si está en la del CRM."""
    return ((await get_effective_many((SENDER_ACCOUNT_KEY,)))[SENDER_ACCOUNT_KEY] or "").strip() or None


async def _notice_templates(user_id: int) -> list[tuple[Audience, dict]]:
    """Las plantillas que usan hoy los avisos, para copiarlas a la WABA del
    número de avisos."""
    templates = {item["id"]: item for item in await list_templates(user_id)}
    chosen: list[tuple[Audience, dict]] = []
    for audience in Audience:
        config = await _config(audience)
        template = templates.get(config.template_id) if config.template_id is not None else None
        if template is not None and template.get("meta_template_id"):
            chosen.append((audience, template))
    return chosen


def _copy_key(name: str | None, language: str | None) -> tuple[str, str]:
    return (name or "", (language or "").lower())


async def _account_templates(account: str, user_id: int) -> list[dict]:
    """Cada plantilla de los avisos y el estado de su copia en la WABA del
    número de avisos: un envío desde ese número solo encuentra las de su
    WABA, por nombre e idioma."""
    remote = {
        _copy_key(item.get("name"), item.get("language")): str(item.get("status") or "")
        for item in await appointment_ports().senders.templates(account)
    }
    return [
        {
            "audience": audience.value,
            "template_id": template["id"],
            "name": template["name"],
            "status": remote.get(_copy_key(template["official_name"], template["official_language"]), "MISSING"),
        }
        for audience, template in await _notice_templates(user_id)
    ]


async def get_sender(user_id: int) -> dict:
    """El número de avisos elegido, los números para elegirlo y, si está en
    su propia WABA, esa cuenta y el estado de las copias de las plantillas."""
    ports = appointment_ports()
    account = await _sender_account()
    numbers = await ports.senders.numbers(account)
    result: dict = {"phone_number_id": await _sender(), "numbers": numbers, "account": None, "templates": []}
    if account is not None:
        result["account"] = {"waba_id": account, "name": await ports.senders.account_name(account)}
        try:
            result["templates"] = await _account_templates(account, user_id)
        except NoticeAccountUnavailable:
            logger.warning("No se leyeron las plantillas de la WABA de avisos %s", account, exc_info=True)
    return result


async def save_sender(phone_number_id: str | None, user_id: int, *, account: str | None = None) -> dict:
    """Elige el número de avisos, o vuelve al del CRM con ``None``. Tiene que
    ser otro número de la WABA del CRM o de la WABA propia del número de
    avisos (``account`` al recién vincularlo); levanta ``InvalidNotice`` si
    no."""
    chosen = (phone_number_id or "").strip() or None
    ports = appointment_ports()
    previous = await _sender()
    chosen_account = ""
    if chosen is not None:
        numbers = await ports.senders.numbers(account or await _sender_account())
        number = next((item for item in numbers if item["id"] == chosen), None)
        if number is None:
            raise InvalidNotice("Ese número no está en ninguna cuenta de WhatsApp Business del negocio")
        if number["is_crm"]:
            raise InvalidNotice("Elige un número distinto al del CRM o deja los avisos en el número del CRM")
        crm_account = next((item["waba_id"] for item in numbers if item["is_crm"]), None)
        if number["waba_id"] != crm_account:
            chosen_account = number["waba_id"]
        await ports.senders.register(chosen, number["waba_id"])
    await update_settings({SENDER_KEY: chosen or "", SENDER_ACCOUNT_KEY: chosen_account})
    if previous is not None and previous != chosen:
        # Si el número anterior siguiera ruteando, lo que le escriban ya no se
        # reconocería como del número de avisos y abriría chats en el CRM.
        await ports.senders.unregister(previous)
    return await get_sender(user_id)


async def copy_templates(user_id: int) -> dict:
    """Crea en la WABA del número de avisos las plantillas de los avisos que
    todavía no están ahí. Meta las revisa de nuevo; hasta que las apruebe,
    el aviso que salga desde ese número queda como fallido en la cita."""
    account = await _sender_account()
    if account is None:
        raise InvalidNotice("El número de avisos está en la cuenta del CRM y usa sus plantillas")
    ports = appointment_ports()
    status = {item["template_id"]: item["status"] for item in await _account_templates(account, user_id)}
    copied: set[int] = set()
    for _audience, template in await _notice_templates(user_id):
        if template["id"] in copied or status.get(template["id"]) != "MISSING":
            continue
        await ports.senders.copy_template(template["meta_template_id"], account)
        copied.add(template["id"])
    return await get_sender(user_id)


async def link_sender(code: str, waba_id: str, phone_number_id: str | None, user_id: int) -> dict:
    """Vincula un número nuevo con el Embedded Signup de Meta (también con
    coexistencia: el número sigue en la app de WhatsApp Business del
    celular, donde se ven las respuestas a los avisos) y lo deja como número
    de avisos. Las credenciales del CRM no cambian. Si quedó en su propia
    WABA (en coexistencia siempre), copia ahí las plantillas de los avisos."""
    linked = await appointment_ports().senders.complete_signup(code, waba_id, phone_number_id)
    result = await save_sender(linked["phone_number_id"], user_id, account=linked["waba_id"])
    if result["account"] is None:
        return result
    try:
        return await copy_templates(user_id)
    except NoticeAccountUnavailable:
        # El número ya quedó vinculado: la tarjeta muestra qué plantillas
        # faltan y permite reintentar la copia.
        logger.warning("No se copiaron las plantillas de avisos a la WABA %s", linked["waba_id"], exc_info=True)
        return result


_DELIVERY_STATUSES = ("sent", "delivered", "read", "failed")


async def record_notice_delivery(
    *, provider_message_id: str | None, wsp_message_id: int | None, status: str, at: datetime | None,
) -> int:
    """Un estado de Meta (``statuses[]`` del webhook) sobre un aviso: el del
    equipo se reconoce por el id de Meta y el del cliente por su mensaje en
    el CRM. Lo que no es un aviso de cita se ignora."""
    if status not in _DELIVERY_STATUSES or (not provider_message_id and wsp_message_id is None):
        return 0
    return await appointment_ports().notices.record_delivery(
        provider_message_id=provider_message_id, wsp_message_id=wsp_message_id, status=status, at=at,
    )


async def notice_account_template_changed(waba_id: str) -> bool:
    """Un evento de plantilla de Meta que llegó por la WABA propia del número
    de avisos: avisa a la tarjeta para que vuelva a leer el estado de las
    copias. Devuelve si era esa WABA."""
    if not waba_id or waba_id != await _sender_account():
        return False
    async with unit_of_work():
        collect(NoticeTemplatesChanged())
    return True
