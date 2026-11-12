"""Los avisos de cita por WhatsApp: cómo los configura el negocio y cómo
salen cuando se guarda una cita.

Al cliente le llega en el chat de su lead (el equipo ve el mensaje en la
conversación). Al equipo (el responsable y los admins) le llega directo a su
número, sin abrir un chat en el CRM: no son leads.
"""

from __future__ import annotations

import logging
from datetime import datetime

from app.modules.appointments.application.ports import appointment_ports
from app.modules.appointments.domain.calendar_event import BUILTIN_FIELDS, CUSTOM_PREFIX
from app.modules.appointments.domain.errors import NoticeNotSent
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


def setting_keys(audience: Audience) -> tuple[str, str, str]:
    prefix = f"appointment_{audience.value}_notice"
    return f"{prefix}_enabled", f"{prefix}_template_id", f"{prefix}_parameters"


async def _config(audience: Audience) -> NoticeConfig:
    enabled, template_id, parameters = setting_keys(audience)
    stored = await get_effective_many((enabled, template_id, parameters))
    return NoticeConfig.from_settings(stored[enabled], stored[template_id], stored[parameters])


def _sendable(template: dict, audience: Audience) -> bool:
    """Solo una plantilla oficial aprobada llega con la ventana de 24 h
    cerrada. Tiene que ser global: el aviso sale a nombre de quien cargó la
    cita, que no ve las plantillas personales de otro. Al equipo no le llega
    una con imagen, porque la imagen la sube el outbox de los chats."""
    return (
        template["template_type"] == "official"
        and template["official_status"] == "APPROVED"
        and template["visibility"] == "global"
        and bool(template["is_active"])
        and (audience is Audience.CLIENT or template.get("official_header_type") != "image")
    )


def _variable_count(template: dict) -> int:
    return len(template["official_parameter_values"] or [])


async def _template(template_id: int | None, user_id: int, audience: Audience) -> dict | None:
    template = next((item for item in await list_templates(user_id) if item["id"] == template_id), None)
    return template if template is not None and _sendable(template, audience) else None


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
    templates = [
        {
            "id": item["id"], "name": item["name"], "content": item["content"],
            "variable_count": _variable_count(item),
            "suggested_parameters": [
                from_template_parameter(value) for value in item["official_parameter_values"] or []
            ],
        }
        for item in await list_templates(user_id)
        if _sendable(item, audience)
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
    try:
        message_id = await ports.messenger.send_to_lead(
            chat_id=appointment["lead_id"], template_id=config.template_id,
            parameters=parameter_values(appointment, config.parameters, lead),
            user_id=appointment["created_by_user_id"], dedupe_key=f"appointment-client-notice:{appointment_id}",
        )
    except Exception as exc:
        logger.warning("No se pudo encolar el aviso al cliente de la cita %s", appointment_id, exc_info=True)
        await ports.notices.record(appointment_id, [{**notice, "status": "failed", "reason": _short(exc)}])
        return "failed"
    await ports.notices.record(appointment_id, [{**notice, "status": "sent", "wsp_message_id": message_id}])
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
                phone=recipient["phone"], template=template, parameters=parameters,
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
