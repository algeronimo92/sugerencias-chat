"""Los avisos de cita por WhatsApp: al cliente en el chat de su lead y al
equipo (responsable y admins) directo a su número, cada uno con la plantilla
oficial que eligió el negocio y los campos de la cita en cada variable."""

from unittest.mock import AsyncMock

import pytest

from app.modules.appointments.application import notice
from app.modules.appointments.domain.errors import NoticeNotSent
from app.modules.appointments.domain.events import AppointmentCreated
from app.modules.appointments.domain.notice import (
    Audience,
    InvalidNotice,
    NoticeConfig,
    parameter_values,
)
from app.modules.appointments.infrastructure.integrations import TeamDirectory
from app.modules.appointments.infrastructure import integrations
from app.modules.notifications import subscribers as notification_subscribers
from tests.appointment_fakes import in_memory_appointments  # noqa: F401

APPROVED = {
    "id": 7, "name": "confirmacion_cita", "content": "Hola {{1}}, tu sesión de {{2}} es el {{3}} a las {{4}}",
    "template_type": "official", "official_status": "APPROVED", "visibility": "global", "is_active": True,
    "official_header_type": None, "official_name": "confirmacion_cita", "official_language": "es",
    "official_parameter_values": ["Ana", "Limpieza", "JUEVES 1 de Enero", "10:00 Am"],
}
WITH_IMAGE = {**APPROVED, "id": 11, "official_header_type": "image"}
PERSONAL = {**APPROVED, "id": 8, "visibility": "personal"}
PENDING = {**APPROVED, "id": 9, "official_status": "PENDING"}
INTERNAL = {**APPROVED, "id": 10, "template_type": "internal"}
SALE = {
    **APPROVED, "id": 12, "name": "nueva_venta", "official_name": "nueva_venta",
    "content": "NUEVA VENTA\nCliente: {{1}}\nDNI: {{2}}\nDetalle: {{3}}\nCita: {{4}} {{5}}\nVendedor: {{6}}",
    "official_parameter_values": ["a", "b", "c", "d", "e", "f"],
}

CLIENT_FIELDS = ["nombre_completo", "tratamiento", "fecha_larga", "hora_12h"]
STAFF_FIELDS = ["nombre_completo", "dni", "detalle", "fecha", "horario", "vendedor"]


@pytest.fixture
def stored(monkeypatch, in_memory_appointments):
    values: dict[str, str] = {}

    async def update(new_values):
        values.update(new_values)

    monkeypatch.setattr(notice, "list_definitions", AsyncMock(return_value=[{"key": "sede", "label": "Sede"}]))
    monkeypatch.setattr(notice, "list_templates", AsyncMock(
        return_value=[APPROVED, WITH_IMAGE, PERSONAL, PENDING, INTERNAL, SALE],
    ))
    monkeypatch.setattr(notice, "get_effective_many", AsyncMock(side_effect=lambda keys: {k: values.get(k, "") for k in keys}))
    monkeypatch.setattr(notice, "update_settings", AsyncMock(side_effect=update))
    return values


APPOINTMENT = {
    "nombre_completo": "AYME", "tratamiento": "Hifu12D", "fecha": "2026-11-12", "hora": "13:00",
    "duration_minutes": 120, "dni": "", "detalle": "", "vendedor": "Grecia", "custom_fields": {"sede": "Miraflores"},
}


def test_dates_and_hours_read_like_the_team_writes_them():
    assert parameter_values(APPOINTMENT, ("fecha_larga", "hora_12h", "fecha", "horario", "hora_fin")) == [
        "JUEVES 12 de Noviembre", "01:00 Pm", "12/11/2026", "de 13:00 a 15:00", "15:00",
    ]
    morning = {**APPOINTMENT, "fecha": "2026-11-09", "hora": "09:00", "duration_minutes": 0}
    assert parameter_values(morning, ("fecha_larga", "hora_12h", "horario")) == ["LUNES 9 de Noviembre", "09:00 Am", "09:00"]
    assert parameter_values({**APPOINTMENT, "hora": "00:30"}, ("hora_12h",)) == ["12:30 Am"]
    assert parameter_values(APPOINTMENT, ("fecha_horario",)) == ["12/11/2026 de 13:00 a 15:00"]
    assert parameter_values({**APPOINTMENT, "duration_minutes": 0}, ("fecha_horario",)) == ["12/11/2026 13:00"]


def test_an_empty_optional_field_goes_as_a_dash():
    # Meta rechaza una variable vacía: un DNI o un detalle sin llenar no
    # puede frenar el aviso de la venta.
    assert parameter_values(APPOINTMENT, ("dni", "detalle", "custom.sede")) == ["-", "-", "Miraflores"]


def test_unreadable_settings_count_as_not_configured():
    assert NoticeConfig.from_settings("true", "abc", "{roto") == NoticeConfig(enabled=True, template_id=None, parameters=())


async def test_only_approved_global_official_templates_are_offered(stored):
    client = await notice.get_settings(Audience.CLIENT, user_id=1)
    staff = await notice.get_settings(Audience.STAFF, user_id=1)

    assert [item["id"] for item in client["templates"]] == [7, 11, 12]
    # Al equipo el envío va directo por el canal, que no sube imágenes.
    assert [item["id"] for item in staff["templates"]] == [7, 12]
    keys = [item["key"] for item in client["fields"]]
    assert {"fecha_larga", "hora_12h", "horario", "custom.sede", "lead.nombre", "lead.custom.sede"} <= set(keys)


async def test_saving_requires_one_field_per_variable(stored):
    with pytest.raises(InvalidNotice):
        await notice.save_settings(Audience.CLIENT, enabled=True, template_id=7, parameters=CLIENT_FIELDS[:2], user_id=1)
    with pytest.raises(InvalidNotice):
        await notice.save_settings(
            Audience.CLIENT, enabled=True, template_id=7, parameters=[*CLIENT_FIELDS[:3], "custom.borrado"], user_id=1,
        )
    for template_id in (8, 9, 10, None):
        with pytest.raises(InvalidNotice):
            await notice.save_settings(Audience.CLIENT, enabled=True, template_id=template_id, parameters=CLIENT_FIELDS, user_id=1)
    with pytest.raises(InvalidNotice):
        await notice.save_settings(Audience.STAFF, enabled=True, template_id=11, parameters=CLIENT_FIELDS, user_id=1)

    result = await notice.save_settings(Audience.CLIENT, enabled=True, template_id=7, parameters=CLIENT_FIELDS, user_id=1)

    assert result["enabled"] is True and result["template_id"] == 7
    # Una clave sola se guarda como una variable armada con ese campo.
    assert result["parameters"] == ["{nombre_completo}", "{tratamiento}", "{fecha_larga}", "{hora_12h}"]
    # Cada destinatario tiene su propia configuración.
    assert (await notice.get_settings(Audience.STAFF, user_id=1))["enabled"] is False


async def test_turning_it_off_needs_no_template(stored):
    result = await notice.save_settings(Audience.STAFF, enabled=False, template_id=None, parameters=[], user_id=1)

    assert result["enabled"] is False


async def _appointment(world, **values) -> int:
    row = await world.repository.add({
        "created_by_user_id": 3, "lead_id": "51955090027", **APPOINTMENT, "test_mode": False, **values,
    })
    return row["id"]


async def test_the_client_gets_the_template_in_their_chat(stored, in_memory_appointments):
    await notice.save_settings(Audience.CLIENT, enabled=True, template_id=7, parameters=CLIENT_FIELDS, user_id=1)
    appointment_id = await _appointment(in_memory_appointments)

    assert await notice.send_client_notice(appointment_id) == "sent"

    assert in_memory_appointments.messenger.sent == [{
        "chat_id": "51955090027", "template_id": 7,
        "parameters": ["AYME", "Hifu12D", "JUEVES 12 de Noviembre", "01:00 Pm"],
        "user_id": 3, "dedupe_key": f"appointment-client-notice:{appointment_id}",
    }]


@pytest.mark.parametrize(("values", "expected"), [
    ({"test_mode": True}, "skipped"),
    ({"lead_id": None}, "no_lead"),
])
async def test_the_client_gets_nothing_when_it_should_not(stored, in_memory_appointments, values, expected):
    await notice.save_settings(Audience.CLIENT, enabled=True, template_id=7, parameters=CLIENT_FIELDS, user_id=1)
    appointment_id = await _appointment(in_memory_appointments, **values)

    assert await notice.send_client_notice(appointment_id) == expected
    assert in_memory_appointments.messenger.sent == []


async def test_nothing_is_sent_while_it_is_off(stored, in_memory_appointments):
    appointment_id = await _appointment(in_memory_appointments)

    assert await notice.send_client_notice(appointment_id) == "disabled"
    assert await notice.send_staff_notice(appointment_id) == {}
    assert in_memory_appointments.messenger.sent == in_memory_appointments.messenger.to_phones == []


async def test_a_failed_client_send_is_reported_not_raised(stored, in_memory_appointments):
    await notice.save_settings(Audience.CLIENT, enabled=True, template_id=7, parameters=CLIENT_FIELDS, user_id=1)
    in_memory_appointments.messenger.error = NoticeNotSent("Lead no encontrado")
    appointment_id = await _appointment(in_memory_appointments)

    assert await notice.send_client_notice(appointment_id) == "failed"


async def test_the_team_gets_the_sale_on_their_own_number(stored, in_memory_appointments):
    await notice.save_settings(Audience.STAFF, enabled=True, template_id=12, parameters=STAFF_FIELDS, user_id=1)
    world = in_memory_appointments
    world.staff.team = [
        {"id": 1, "name": "Alan", "phone": "51906471403"},
        {"id": 5, "name": "Grecia", "phone": "51927345336"},
    ]
    world.messenger.error = NoticeNotSent("Meta rechazó el número")
    world.messenger.failing_phones = {"51906471403"}
    appointment_id = await _appointment(world)

    # Un número que falla no deja sin aviso a los demás.
    assert await notice.send_staff_notice(appointment_id) == {1: "failed", 5: "sent"}

    assert world.staff.asked == ["Grecia"]
    assert world.messenger.to_phones == [{
        "phone": "51927345336", "template_id": 12,
        "parameters": ["AYME", "-", "-", "12/11/2026", "de 13:00 a 15:00", "Grecia"],
    }]


async def test_the_team_gets_nothing_for_a_test_appointment(stored, in_memory_appointments):
    await notice.save_settings(Audience.STAFF, enabled=True, template_id=12, parameters=STAFF_FIELDS, user_id=1)
    in_memory_appointments.staff.team = [{"id": 1, "name": "Alan", "phone": "51906471403"}]
    appointment_id = await _appointment(in_memory_appointments, test_mode=True)

    assert await notice.send_staff_notice(appointment_id) == {}
    assert in_memory_appointments.messenger.to_phones == []


async def test_recipients_are_the_seller_and_the_admins_with_a_phone(monkeypatch):
    monkeypatch.setattr(integrations, "list_active_sellers", AsyncMock(return_value=[
        {"id": 1, "name": "Alan", "role": "admin"},
        {"id": 2, "name": "Rosa", "role": "admin"},
        {"id": 5, "name": "Grecia", "role": "vendedor"},
        {"id": 6, "name": "Antonella", "role": "vendedor"},
    ]))
    phones = AsyncMock(return_value={1: "51906471403", 5: "51927345336", 6: "51996961136"})
    monkeypatch.setattr(integrations, "staff_phones", phones)

    recipients = await TeamDirectory().recipients(" grecia ")

    # Rosa no tiene teléfono; Antonella no es la responsable.
    assert recipients == [
        {"id": 1, "name": "Alan", "phone": "51906471403"},
        {"id": 5, "name": "Grecia", "phone": "51927345336"},
    ]
    phones.assert_awaited_once_with([1, 2, 5])


async def test_the_assigned_seller_is_notified_in_the_app_too(monkeypatch):
    sent_to: list[int] = []

    async def create(recipient_id, *_args, **_kwargs):
        sent_to.append(recipient_id)
        return {"id": recipient_id}

    monkeypatch.setattr(notification_subscribers, "list_active_admin_ids", AsyncMock(return_value=[1]))
    monkeypatch.setattr(notification_subscribers, "list_active_sellers", AsyncMock(return_value=[
        {"id": 1, "name": "Admin", "role": "admin"},
        {"id": 5, "name": "Antonella", "role": "vendedor"},
        {"id": 6, "name": "Grecia", "role": "vendedor"},
    ]))
    monkeypatch.setattr(notification_subscribers, "create_system_notification", create)
    monkeypatch.setattr(notification_subscribers.manager, "send_to_user", AsyncMock())
    monkeypatch.setattr(notification_subscribers, "send_push_to_user", AsyncMock())

    await notification_subscribers.notify_new_appointment(AppointmentCreated(
        appointment_id=41, created_by_user_id=3, seller_name=" antonella ", title="Nueva cita", text="x",
    ))

    assert sorted(sent_to) == [1, 3, 5]


async def test_the_team_template_is_built_like_any_official_send():
    from app.modules.conversations.chat_messaging import TemplateNotSendableError, official_template_message

    message = await official_template_message(SALE, ["AYME", "-", "-", "12/11/2026", "de 13:00 a 15:00", "Grecia"])

    assert message["type"] == "template"
    assert message["template"]["name"] == "nueva_venta"
    assert [item["text"] for item in message["template"]["components"][0]["parameters"]][0] == "AYME"
    with pytest.raises(TemplateNotSendableError):
        await official_template_message(WITH_IMAGE, ["a", "b", "c", "d"])



def test_a_variable_mixes_free_text_with_appointment_and_lead_fields():
    lead = {"nombre": "Ayme Torres", "telefono": "51955090027", "custom_fields": {"distrito": "Surco"}}
    values = parameter_values(
        APPOINTMENT,
        ("{fecha_larga} a las {hora_12h}", "{lead.nombre} ({lead.custom.distrito})", "DNI {dni}", "Gracias"),
        lead,
    )

    assert values == ["JUEVES 12 de Noviembre a las 01:00 Pm", "Ayme Torres (Surco)", "-", "Gracias"]


def test_a_value_with_line_breaks_goes_in_one_line():
    # WhatsApp rechaza saltos de línea dentro de una variable (132018).
    detalle = "Primera sesión" + chr(10) * 2 + "Traer  exámenes"
    assert parameter_values({**APPOINTMENT, "detalle": detalle}, ("{detalle}",)) == [
        "Primera sesión Traer exámenes",
    ]


async def test_saving_rejects_an_unknown_field_inside_a_variable(stored):
    with pytest.raises(InvalidNotice):
        await notice.save_settings(
            Audience.CLIENT, enabled=True, template_id=7,
            parameters=["{nombre_completo}", "{tratamiento}", "{fecha_larga}", "a las {hora_inventada}"], user_id=1,
        )
    with pytest.raises(InvalidNotice):
        await notice.save_settings(
            Audience.CLIENT, enabled=True, template_id=7,
            parameters=["{nombre_completo}", "  ", "{fecha_larga}", "{hora_12h}"], user_id=1,
        )


async def test_the_builder_previews_the_last_real_appointment(stored, in_memory_appointments):
    in_memory_appointments.leads.snapshots["51955090027"] = {"nombre": "Ayme Torres", "custom_fields": {}}
    await _appointment(in_memory_appointments)
    await _appointment(in_memory_appointments, nombre_completo="Prueba", test_mode=True)

    preview = (await notice.get_settings(Audience.CLIENT, user_id=1))["preview"]

    assert preview["label"] == "AYME · Hifu12D"
    assert preview["values"]["fecha_larga"] == "JUEVES 12 de Noviembre"
    assert preview["values"]["lead.nombre"] == "Ayme Torres"


async def test_the_client_notice_can_use_the_lead_data(stored, in_memory_appointments):
    await notice.save_settings(
        Audience.CLIENT, enabled=True, template_id=7,
        parameters=["{lead.nombre}", "{tratamiento}", "{fecha_larga}", "{hora_12h}"], user_id=1,
    )
    in_memory_appointments.leads.snapshots["51955090027"] = {"nombre": "Ayme Torres"}
    appointment_id = await _appointment(in_memory_appointments)

    assert await notice.send_client_notice(appointment_id) == "sent"
    assert in_memory_appointments.messenger.sent[0]["parameters"][0] == "Ayme Torres"


def test_a_template_variable_becomes_a_notice_variable():
    from app.modules.appointments.domain.notice import from_template_parameter

    assert from_template_parameter("{{cita.fecha_larga}} a las {{cita.hora_12h}}") == "{fecha_larga} a las {hora_12h}"
    assert from_template_parameter("{{nombre}}") == "{lead.nombre}"
    assert from_template_parameter("Clínica") == "Clínica"
