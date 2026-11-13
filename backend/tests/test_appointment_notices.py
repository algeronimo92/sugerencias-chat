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
    "meta_template_id": "META_7",
    "official_parameter_values": ["Ana", "Limpieza", "JUEVES 1 de Enero", "10:00 Am"],
}
WITH_IMAGE = {**APPROVED, "id": 11, "official_header_type": "image"}
PERSONAL = {**APPROVED, "id": 8, "visibility": "personal"}
PENDING = {**APPROVED, "id": 9, "official_status": "PENDING"}
INTERNAL = {**APPROVED, "id": 10, "template_type": "internal"}
SALE = {
    **APPROVED, "id": 12, "name": "nueva_venta", "official_name": "nueva_venta", "meta_template_id": "META_12",
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
        {"id": 1, "name": "Alan", "phone": "51900000001"},
        {"id": 5, "name": "Grecia", "phone": "51900000002"},
    ]
    world.messenger.error = NoticeNotSent("Meta rechazó el número")
    world.messenger.failing_phones = {"51900000001"}
    appointment_id = await _appointment(world)

    # Un número que falla no deja sin aviso a los demás.
    assert await notice.send_staff_notice(appointment_id) == {1: "failed", 5: "sent"}

    assert world.staff.asked == ["Grecia"]
    assert world.messenger.to_phones == [{
        "phone": "51900000002", "template_id": 12,
        "parameters": ["AYME", "-", "-", "12/11/2026", "de 13:00 a 15:00", "Grecia"],
    }]


async def test_the_team_gets_nothing_for_a_test_appointment(stored, in_memory_appointments):
    await notice.save_settings(Audience.STAFF, enabled=True, template_id=12, parameters=STAFF_FIELDS, user_id=1)
    in_memory_appointments.staff.team = [{"id": 1, "name": "Alan", "phone": "51900000001"}]
    appointment_id = await _appointment(in_memory_appointments, test_mode=True)

    assert await notice.send_staff_notice(appointment_id) == {}
    assert in_memory_appointments.messenger.to_phones == []


async def test_recipients_are_the_seller_and_the_admins(monkeypatch):
    monkeypatch.setattr(integrations, "list_active_sellers", AsyncMock(return_value=[
        {"id": 1, "name": "Alan", "role": "admin"},
        {"id": 2, "name": "Rosa", "role": "admin"},
        {"id": 5, "name": "Grecia", "role": "vendedor"},
        {"id": 6, "name": "Antonella", "role": "vendedor"},
    ]))
    phones = AsyncMock(return_value={1: "51900000001", 5: "51900000002", 6: "51900000003"})
    monkeypatch.setattr(integrations, "staff_phones", phones)

    recipients = await TeamDirectory().recipients(" grecia ")

    # Rosa va sin teléfono: su aviso queda registrado como no enviado.
    # Antonella no es la responsable.
    assert recipients == [
        {"id": 1, "name": "Alan", "phone": "51900000001"},
        {"id": 2, "name": "Rosa", "phone": None},
        {"id": 5, "name": "Grecia", "phone": "51900000002"},
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


async def test_the_team_notice_reaches_the_number_through_the_real_channel(monkeypatch):
    # En producción el aviso al equipo pasaba el número como id de un lead y
    # fallaba con 'invalid UUID' antes de llegar a Meta (cita 359). Este test
    # recorre el canal de verdad, con Meta simulado en la última llamada.
    from app.integrations.meta import client as meta_client

    sent: list[dict] = []

    async def fake_config():
        return "token", "PHONE_ID", "WABA_ID"

    async def fake_request(method, url, token, *, json_body=None, **_kwargs):
        sent.append({"method": method, "url": url, "body": json_body})
        return {"messages": [{"id": "wamid.equipo"}]}

    async def no_lead_lookup(_chat_id):
        raise AssertionError("un número del equipo no se busca como lead")

    monkeypatch.setattr(meta_client, "_config", fake_config)
    monkeypatch.setattr(meta_client, "_request", fake_request)
    monkeypatch.setattr(meta_client, "_recipient", no_lead_lookup)

    await integrations.WhatsAppNoticeMessenger().send_to_phone(
        phone="51900000002", template=SALE, parameters=["AYME", "-", "-", "12/11/2026", "de 13:00 a 15:00", "Grecia"],
    )

    [request] = sent
    assert request["method"] == "POST" and request["url"].endswith("PHONE_ID/messages")
    assert request["body"]["to"] == "51900000002"
    assert request["body"]["type"] == "template"
    assert request["body"]["template"]["name"] == "nueva_venta"


async def test_an_unexpected_error_with_one_member_does_not_stop_the_rest(stored, in_memory_appointments):
    await notice.save_settings(Audience.STAFF, enabled=True, template_id=12, parameters=STAFF_FIELDS, user_id=1)
    world = in_memory_appointments
    world.staff.team = [
        {"id": 1, "name": "Admin", "phone": "51900000001"},
        {"id": 2, "name": "Grecia", "phone": "51900000002"},
    ]
    world.messenger.error = RuntimeError("invalid UUID '51900000001'")
    world.messenger.failing_phones = {"51900000001"}
    appointment_id = await _appointment(world)

    assert await notice.send_staff_notice(appointment_id) == {1: "failed", 2: "sent"}
    assert [item["phone"] for item in world.messenger.to_phones] == ["51900000002"]



async def test_every_notice_is_recorded_on_the_appointment(stored, in_memory_appointments):
    await notice.save_settings(Audience.CLIENT, enabled=True, template_id=7, parameters=CLIENT_FIELDS, user_id=1)
    await notice.save_settings(Audience.STAFF, enabled=True, template_id=12, parameters=STAFF_FIELDS, user_id=1)
    world = in_memory_appointments
    world.staff.team = [
        {"id": 1, "name": "Admin", "phone": "51900000001"},
        {"id": 2, "name": "Rosa", "phone": None},
        {"id": 5, "name": "Grecia", "phone": "51900000002"},
    ]
    world.messenger.error = RuntimeError("Meta rechazó el número")
    world.messenger.failing_phones = {"51900000001"}
    appointment_id = await _appointment(world)

    assert await notice.send_client_notice(appointment_id) == "failed"
    world.messenger.error = None
    assert await notice.send_client_notice(appointment_id) == "sent"
    world.messenger.error = RuntimeError("Meta rechazó el número")
    assert await notice.send_staff_notice(appointment_id) == {1: "failed", 2: "skipped", 5: "sent"}

    rows = [(row["audience"], row["recipient_name"], row["status"], row.get("reason")) for row in world.notices.rows]
    assert rows == [
        ("client", "AYME", "failed", "Meta rechazó el número"),
        ("client", "AYME", "sent", None),
        ("staff", "Admin", "failed", "Meta rechazó el número"),
        ("staff", "Rosa", "skipped", "Sin WhatsApp cargado en Usuarios"),
        ("staff", "Grecia", "sent", None),
    ]
    assert world.notices.rows[1]["wsp_message_id"] == 9001
    assert world.notices.rows[4]["provider_message_id"] == "wamid.51900000002"


async def test_a_client_notice_without_lead_is_recorded_as_not_sent(stored, in_memory_appointments):
    await notice.save_settings(Audience.CLIENT, enabled=True, template_id=7, parameters=CLIENT_FIELDS, user_id=1)
    appointment_id = await _appointment(in_memory_appointments, lead_id=None)

    assert await notice.send_client_notice(appointment_id) == "no_lead"
    [row] = in_memory_appointments.notices.rows
    assert (row["status"], row["reason"]) == ("skipped", "La cita no está vinculada a un lead")


async def test_meta_statuses_reach_the_notice(in_memory_appointments):
    assert await notice.record_notice_delivery(
        provider_message_id="wamid.x", wsp_message_id=None, status="read", at=None,
    ) == 1
    # Estados que no son de entrega, o sin id, no se buscan.
    assert await notice.record_notice_delivery(
        provider_message_id="wamid.x", wsp_message_id=None, status="played", at=None,
    ) == 0
    assert await notice.record_notice_delivery(provider_message_id=None, wsp_message_id=None, status="read", at=None) == 0
    assert in_memory_appointments.notices.deliveries == [
        {"provider_message_id": "wamid.x", "wsp_message_id": None, "status": "read", "at": None},
    ]


# --- Número de avisos: otro número de la misma WABA ------------------------


async def test_the_notice_number_must_be_another_number_of_the_waba(stored, in_memory_appointments):
    with pytest.raises(InvalidNotice, match="no está en ninguna cuenta"):
        await notice.save_sender("OTRA_WABA", 1)
    with pytest.raises(InvalidNotice, match="distinto al del CRM"):
        await notice.save_sender("CRM_ID", 1)
    assert in_memory_appointments.senders.registered == []

    result = await notice.save_sender("AVISOS_ID", 1)

    assert result["phone_number_id"] == "AVISOS_ID"
    assert stored[notice.SENDER_KEY] == "AVISOS_ID"
    # Registrado para que sus estados de entrega encuentren el negocio.
    assert in_memory_appointments.senders.registered == ["AVISOS_ID"]

    assert (await notice.save_sender(None, 1))["phone_number_id"] is None
    assert stored[notice.SENDER_KEY] == ""
    # El número que dejó de ser el de avisos deja de rutear: si no, lo que le
    # escriban abriría chats en el CRM.
    assert in_memory_appointments.senders.unregistered == ["AVISOS_ID"]


async def test_with_a_notice_number_the_client_gets_it_from_that_number(stored, in_memory_appointments):
    await notice.save_settings(Audience.CLIENT, enabled=True, template_id=7, parameters=CLIENT_FIELDS, user_id=1)
    await notice.save_sender("AVISOS_ID", 1)
    world = in_memory_appointments
    appointment_id = await _appointment(world)

    assert await notice.send_client_notice(appointment_id) == "sent"

    # No pasa por el chat del lead: el cliente lo recibe de otro número.
    assert world.messenger.sent == []
    assert world.messenger.from_sender == [{
        "chat_id": "51955090027", "template_id": 7,
        "parameters": ["AYME", "Hifu12D", "JUEVES 12 de Noviembre", "01:00 Pm"], "sender": "AVISOS_ID",
    }]
    [row] = world.notices.rows
    assert (row["status"], row["provider_message_id"]) == ("sent", "wamid.lead.51955090027")
    assert "wsp_message_id" not in row


async def test_with_a_notice_number_the_team_gets_it_from_that_number(stored, in_memory_appointments):
    await notice.save_settings(Audience.STAFF, enabled=True, template_id=12, parameters=STAFF_FIELDS, user_id=1)
    await notice.save_sender("AVISOS_ID", 1)
    world = in_memory_appointments
    world.staff.team = [{"id": 5, "name": "Grecia", "phone": "51900000002"}]
    appointment_id = await _appointment(world)

    assert await notice.send_staff_notice(appointment_id) == {5: "sent"}
    assert world.messenger.to_phones[0]["sender"] == "AVISOS_ID"


async def test_a_failed_send_from_the_notice_number_is_recorded(stored, in_memory_appointments):
    await notice.save_settings(Audience.CLIENT, enabled=True, template_id=7, parameters=CLIENT_FIELDS, user_id=1)
    await notice.save_sender("AVISOS_ID", 1)
    world = in_memory_appointments
    world.messenger.error = RuntimeError("Meta rechazó el número")
    appointment_id = await _appointment(world)

    assert await notice.send_client_notice(appointment_id) == "failed"
    [row] = world.notices.rows
    assert (row["status"], row["reason"]) == ("failed", "Meta rechazó el número")


async def test_with_a_notice_number_the_team_can_use_a_template_with_image(stored, in_memory_appointments):
    # Desde el número del CRM la imagen del encabezado la sube el outbox de
    # los chats, que no interviene en el aviso al equipo; desde el número de
    # avisos la sube el envío mismo.
    staff = await notice.get_settings(Audience.STAFF, user_id=1)
    assert 11 not in [item["id"] for item in staff["templates"]]

    await notice.save_sender("AVISOS_ID", 1)

    staff = await notice.get_settings(Audience.STAFF, user_id=1)
    assert 11 in [item["id"] for item in staff["templates"]]


async def test_the_notice_number_sends_through_its_own_phone_number_id(monkeypatch):
    from app.integrations.meta import client as meta_client

    sent: list[dict] = []

    async def fake_config():
        return "token", "CRM_ID", "WABA_ID"

    async def fake_request(method, url, token, *, json_body=None, **_kwargs):
        sent.append({"url": url, "body": json_body})
        return {"messages": [{"id": "wamid.avisos"}]}

    async def recipient(chat_id):
        return {"to": "51955090027"}

    monkeypatch.setattr(meta_client, "_config", fake_config)
    monkeypatch.setattr(meta_client, "_request", fake_request)
    monkeypatch.setattr(meta_client, "_recipient", recipient)
    messenger = integrations.WhatsAppNoticeMessenger()

    assert await messenger.send_to_lead_from(
        chat_id="lead-1", template=APPROVED, parameters=["AYME", "Hifu12D", "JUEVES", "01:00 Pm"], sender="AVISOS_ID",
    ) == "wamid.avisos"
    assert await messenger.send_to_phone(
        phone="51900000002", template=SALE, parameters=["a", "b", "c", "d", "e", "f"], sender="AVISOS_ID",
    ) == "wamid.avisos"

    assert [item["url"].rsplit("/", 2)[-2] for item in sent] == ["AVISOS_ID", "AVISOS_ID"]
    assert sent[0]["body"]["to"] == "51955090027"
    assert sent[1]["body"]["to"] == "51900000002"


async def test_the_image_header_is_uploaded_by_the_notice_number(monkeypatch):
    from app.integrations.meta import client as meta_client

    uploads: list[str | None] = []
    posted: list[dict] = []

    async def fake_upload(content, content_type, filename, *, sender_phone_number_id=None):
        uploads.append(sender_phone_number_id)
        return "MEDIA_1"

    async def fake_send(phone, message, *, sender_phone_number_id=None):
        posted.append(message)
        return {"body": message, "response": {"messages": [{"id": "wamid.img"}]}}

    # El envío pasa por el canal de Meta, que llama al cliente.

    class Info:
        content_type = "image/png"

    monkeypatch.setattr(integrations, "stat_media", lambda url: Info())
    monkeypatch.setattr(integrations, "read_media_bytes", lambda url: b"png")
    monkeypatch.setattr(meta_client, "upload_media", fake_upload)
    monkeypatch.setattr(meta_client, "send_message_to_number", fake_send)
    template = {
        **SALE, "official_header_type": "image",
        "official_header_media_url": "media/banner.png", "official_header_media_filename": "banner.png",
    }

    await integrations.WhatsAppNoticeMessenger().send_to_phone(
        phone="51900000002", template=template, parameters=["a", "b", "c", "d", "e", "f"], sender="AVISOS_ID",
    )

    assert uploads == ["AVISOS_ID"]
    [message] = posted
    assert message["template"]["components"][0] == {
        "type": "header", "parameters": [{"type": "image", "image": {"id": "MEDIA_1"}}],
    }


async def test_the_numbers_of_the_waba_mark_the_crm_one(monkeypatch):
    from app.integrations.meta import client as meta_client

    monkeypatch.setattr(meta_client, "list_phone_numbers", AsyncMock(return_value=[
        {"id": "CRM_ID", "display_phone_number": "+51 1", "verified_name": "A", "waba_id": "WABA_ID"},
        {"id": "AVISOS_ID", "display_phone_number": "+51 2", "verified_name": "B", "waba_id": "WABA_ID"},
    ]))
    monkeypatch.setattr(integrations, "get_effective", AsyncMock(return_value="CRM_ID"))

    numbers = await integrations.MetaNoticeSenders().numbers()

    assert [(item["id"], item["is_crm"]) for item in numbers] == [("CRM_ID", True), ("AVISOS_ID", False)]


# --- Vincular el número de avisos con el Embedded Signup (coexistencia) ----


async def test_linking_a_number_with_meta_makes_it_the_notice_number(stored, in_memory_appointments):
    result = await notice.link_sender("CODE", "WABA_ID", None, 1)

    assert in_memory_appointments.senders.signups == [
        {"code": "CODE", "waba_id": "WABA_ID", "phone_number_id": None},
    ]
    assert result["phone_number_id"] == "AVISOS_ID"
    assert stored[notice.SENDER_KEY] == "AVISOS_ID"
    assert in_memory_appointments.senders.registered == ["AVISOS_ID"]


async def test_a_failed_link_changes_nothing(stored, in_memory_appointments):
    from app.modules.appointments.domain.errors import NoticeSenderNotLinked

    in_memory_appointments.senders.signup_error = NoticeSenderNotLinked("Quedó en otra WABA")

    with pytest.raises(NoticeSenderNotLinked):
        await notice.link_sender("CODE", "OTRA_WABA", None, 1)
    assert notice.SENDER_KEY not in stored


def _graph(
    monkeypatch, numbers: list[str], *, crm=("token", "CRM_ID", "WABA_ID"), notice_number="",
    owners: dict[str, str] | None = None,
):
    from app.integrations.meta import client as meta_client

    calls: list[tuple[str, str]] = []
    owners = owners or {}

    async def fake_exchange(code):
        return "NUEVO_TOKEN"

    async def fake_config():
        return crm

    async def fake_request(method, url, token, **_kwargs):
        calls.append((method, url))
        if url.endswith("/phone_numbers"):
            return {"data": [{"id": number} for number in numbers]}
        waba = url.rsplit("/", 1)[-1]
        if method == "GET" and waba in owners:
            return {"owner_business_info": {"id": owners[waba]}}
        return {"success": True}

    saved: list[dict] = []

    async def fake_update(values):
        saved.append(values)

    monkeypatch.setattr(meta_client, "_exchange_code", fake_exchange)
    monkeypatch.setattr(meta_client, "_config", fake_config)
    monkeypatch.setattr(meta_client, "_request", fake_request)
    monkeypatch.setattr(meta_client, "update_settings", fake_update)
    monkeypatch.setattr(meta_client, "get_effective_many", AsyncMock(
        side_effect=lambda keys: {key: notice_number for key in keys},
    ))
    monkeypatch.setattr(meta_client, "get_current_tenant", lambda: None)
    return meta_client, calls, saved


async def test_coexistence_signup_picks_the_number_that_is_not_the_crm(monkeypatch):
    meta_client, calls, saved = _graph(monkeypatch, ["CRM_ID", "AVISOS_ID"])

    assert await meta_client.complete_notice_number_signup("CODE", "WABA_ID") == {
        "phone_number_id": "AVISOS_ID", "waba_id": "WABA_ID",
    }
    # No toca las credenciales del CRM.
    assert saved == []
    assert ("POST", meta_client._graph_url("WABA_ID/subscribed_apps")) in calls


async def test_coexistence_can_leave_the_notice_number_in_its_own_waba_of_the_same_portfolio(monkeypatch):
    # En coexistencia Meta no deja elegir una WABA existente: crea otra en el
    # portfolio (pasó con el número de avisos de DermicaPro).
    meta_client, calls, saved = _graph(
        monkeypatch, ["AVISOS_ID"], owners={"WABA_ID": "PORTFOLIO", "WABA_AVISOS": "PORTFOLIO"},
    )

    assert await meta_client.complete_notice_number_signup("CODE", "WABA_AVISOS") == {
        "phone_number_id": "AVISOS_ID", "waba_id": "WABA_AVISOS",
    }
    assert saved == []
    assert ("POST", meta_client._graph_url("WABA_AVISOS/subscribed_apps")) in calls


async def test_the_notice_number_cannot_land_in_another_portfolio(monkeypatch):
    meta_client, calls, _saved = _graph(
        monkeypatch, ["AVISOS_ID"], owners={"WABA_ID": "PORTFOLIO", "OTRA_WABA": "OTRO_NEGOCIO"},
    )

    with pytest.raises(meta_client.MetaApiError, match="otro portfolio"):
        await meta_client.complete_notice_number_signup("CODE", "OTRA_WABA")
    assert not any(url.endswith("subscribed_apps") for _method, url in calls)


async def test_the_crm_number_cannot_be_the_notice_number(monkeypatch):
    meta_client, _calls, _saved = _graph(monkeypatch, ["CRM_ID", "AVISOS_ID"])

    with pytest.raises(meta_client.MetaApiError, match="número del CRM"):
        await meta_client.complete_notice_number_signup("CODE", "WABA_ID", "CRM_ID")


async def test_relinking_the_crm_with_two_numbers_skips_the_notice_number(monkeypatch):
    # Antes, con dos números en la WABA, la coexistencia del CRM fallaba
    # porque no sabía cuál elegir.
    meta_client, _calls, saved = _graph(monkeypatch, ["CRM_ID", "AVISOS_ID"], notice_number="AVISOS_ID")

    await meta_client.complete_embedded_signup("CODE", "WABA_ID")

    assert saved[0]["meta_phone_number_id"] == "CRM_ID"


# --- Número de avisos en su propia WABA (coexistencia) ---------------------

OWN = {"id": "AVISOS_PROPIO", "display_phone_number": "+51 974 637 783", "verified_name": "Avisos",
       "waba_id": "WABA_AVISOS", "is_crm": False}


def _own_account(world):
    world.senders.available = [world.senders.available[0]]
    world.senders.accounts = {"WABA_AVISOS": [OWN]}
    world.senders.signup_account = "WABA_AVISOS"


async def _both_notices():
    await notice.save_settings(Audience.CLIENT, enabled=True, template_id=7, parameters=CLIENT_FIELDS, user_id=1)
    await notice.save_settings(Audience.STAFF, enabled=True, template_id=12, parameters=STAFF_FIELDS, user_id=1)


async def test_linking_into_its_own_waba_copies_the_notice_templates(stored, in_memory_appointments):
    world = in_memory_appointments
    _own_account(world)
    await _both_notices()

    result = await notice.link_sender("CODE", "WABA_AVISOS", "AVISOS_PROPIO", 1)

    assert stored[notice.SENDER_KEY] == "AVISOS_PROPIO"
    assert stored[notice.SENDER_ACCOUNT_KEY] == "WABA_AVISOS"
    # Sus webhooks (estados y plantillas) se rutean por su propia WABA.
    assert world.senders.registered_accounts == ["WABA_AVISOS"]
    assert world.senders.copies == [("META_7", "WABA_AVISOS"), ("META_12", "WABA_AVISOS")]
    assert result["account"] == {"waba_id": "WABA_AVISOS", "name": "Cuenta WABA_AVISOS"}


async def test_only_the_missing_templates_are_copied(stored, in_memory_appointments):
    world = in_memory_appointments
    _own_account(world)
    await _both_notices()
    await notice.save_sender("AVISOS_PROPIO", 1, account="WABA_AVISOS")
    world.senders.account_templates = {"WABA_AVISOS": [
        {"name": "confirmacion_cita", "language": "es", "status": "PENDING"},
    ]}

    result = await notice.copy_templates(1)

    assert world.senders.copies == [("META_12", "WABA_AVISOS")]
    assert [(item["audience"], item["name"], item["status"]) for item in result["templates"]] == [
        ("client", "confirmacion_cita", "PENDING"), ("staff", "nueva_venta", "MISSING"),
    ]


async def test_a_failed_copy_leaves_the_number_linked(stored, in_memory_appointments):
    from app.modules.appointments.domain.errors import NoticeAccountUnavailable

    world = in_memory_appointments
    _own_account(world)
    await _both_notices()
    world.senders.copy_error = NoticeAccountUnavailable("Meta rechazó la plantilla")

    result = await notice.link_sender("CODE", "WABA_AVISOS", "AVISOS_PROPIO", 1)

    assert result["phone_number_id"] == "AVISOS_PROPIO"
    assert stored[notice.SENDER_ACCOUNT_KEY] == "WABA_AVISOS"
    assert [item["status"] for item in result["templates"]] == ["MISSING", "MISSING"]


async def test_going_back_to_the_crm_number_forgets_the_own_waba(stored, in_memory_appointments):
    world = in_memory_appointments
    _own_account(world)
    await notice.link_sender("CODE", "WABA_AVISOS", "AVISOS_PROPIO", 1)

    result = await notice.save_sender(None, 1)

    assert stored[notice.SENDER_ACCOUNT_KEY] == ""
    assert result["account"] is None
    assert world.senders.unregistered == ["AVISOS_PROPIO"]


async def test_in_the_crm_waba_there_is_nothing_to_copy(stored, in_memory_appointments):
    await notice.save_sender("AVISOS_ID", 1)

    assert stored[notice.SENDER_ACCOUNT_KEY] == ""
    with pytest.raises(InvalidNotice, match="usa sus plantillas"):
        await notice.copy_templates(1)


async def test_copying_a_template_reuploads_its_image_header(monkeypatch):
    from app.integrations.meta import client as meta_client

    posted: list[tuple[str, dict]] = []

    async def fake_config():
        return "token", "CRM_ID", "WABA_ID"

    async def fake_request(method, url, token, *, json_body=None, **_kwargs):
        posted.append((url, json_body))
        return {"id": "NUEVA", "status": "PENDING"}

    monkeypatch.setattr(meta_client, "_config", fake_config)
    monkeypatch.setattr(meta_client, "_request", fake_request)
    monkeypatch.setattr(meta_client, "get_whatsapp_template", AsyncMock(return_value={
        "name": "nueva_venta", "language": "es", "category": "UTILITY", "components": [
            {"type": "HEADER", "format": "IMAGE", "example": {"header_handle": ["https://scontent/x.png"]}},
            {"type": "BODY", "text": "Hola {{1}}", "example": {"body_text": [["Ana"]]}},
        ],
    }))
    monkeypatch.setattr(meta_client, "download_template_header_example", AsyncMock(return_value=(b"png", "image/png")))
    monkeypatch.setattr(meta_client, "upload_header_media", AsyncMock(return_value="HANDLE"))

    await meta_client.copy_whatsapp_template("META_12", "WABA_AVISOS")

    [(url, body)] = posted
    assert url == meta_client._graph_url("WABA_AVISOS/message_templates")
    assert (body["name"], body["language"], body["category"]) == ("nueva_venta", "es", "UTILITY")
    assert body["components"][0]["example"] == {"header_handle": ["HANDLE"]}
    assert body["components"][1] == {"type": "BODY", "text": "Hola {{1}}", "example": {"body_text": [["Ana"]]}}


async def test_a_template_event_of_the_notice_account_refreshes_its_card(stored, in_memory_appointments, monkeypatch):
    from contextlib import asynccontextmanager

    from app.modules.appointments.domain.events import NoticeTemplatesChanged

    collected: list = []

    @asynccontextmanager
    async def fake_uow():
        yield None

    monkeypatch.setattr(notice, "unit_of_work", fake_uow)
    monkeypatch.setattr(notice, "collect", lambda *events: collected.extend(events))
    _own_account(in_memory_appointments)
    await notice.link_sender("CODE", "WABA_AVISOS", "AVISOS_PROPIO", 1)

    assert await notice.notice_account_template_changed("WABA_ID") is False
    assert await notice.notice_account_template_changed("WABA_AVISOS") is True
    assert collected == [NoticeTemplatesChanged()]
