"""El negocio desvincula su número desde WhatsApp y el CRM tiene que enterarse.

El 20-11-2026 DermicaPro desconectó su cuenta: Meta lo avisó por webhook
(``account_update``) y rechazó cada envío, pero el CRM siguió mostrando
"conectado" porque solo miraba si había credenciales guardadas.
"""

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from app.integrations.meta import client as meta_service
from app.integrations.meta_webhook import processor
from app.integrations.meta_webhook.inbox import InboxEvent, split_changes
from app.integrations.whatsapp.channel import describe_send_failure, is_transient_send_failure
from app.integrations.whatsapp.identity import Destination
from app.modules.platform import onboarding, settings_service, whatsapp_api
from tests.meta_fixtures import WABA_ID, webhook_body
from tests.test_meta_client import _FakeGraphClient, _FakeGraphResponse, _mock_config

# Lo que respondió Meta a cada envío de DermicaPro después de la baja.
NUMBER_GONE = {"error": {
    "message": "Unsupported post request. Object with ID 'PHONE1' does not exist, cannot be loaded "
               "due to missing permissions, or does not support this operation.",
    "type": "GraphMethodException", "code": 100, "error_subcode": 33,
}}
BUSINESS_PORTFOLIO_ID = "900000000000009"


def _settings(monkeypatch, **stored):
    """Ajustes del negocio en memoria: lo que lee y guarda el cliente de Meta."""
    saved: list[dict] = []

    async def fake_update(values):
        saved.append(dict(values))
        stored.update(values)

    monkeypatch.setattr(meta_service, "get_effective_many", AsyncMock(
        side_effect=lambda keys: {key: stored.get(key, "") for key in keys},
    ))
    monkeypatch.setattr(meta_service, "update_settings", fake_update)
    alert = AsyncMock(return_value=True)
    monkeypatch.setattr(meta_service, "try_send_operational_alert", alert)
    return saved, alert


def _rejecting_client(monkeypatch, payload):
    client = _FakeGraphClient([_FakeGraphResponse(payload, is_error=True, status_code=400)])
    monkeypatch.setattr(meta_service, "_client", lambda: client)
    monkeypatch.setattr(
        meta_service, "resolve_whatsapp_destination",
        AsyncMock(return_value=Destination(wa_id="51906471403", user_id=None)),
    )
    return client


def _account_event(event: str, waba_id: str = WABA_ID) -> InboxEvent:
    value = {"event": event, "waba_info": {"waba_id": waba_id, "owner_business_id": BUSINESS_PORTFOLIO_ID}}
    change = split_changes(webhook_body(value, field="account_update", entry_id=BUSINESS_PORTFOLIO_ID))[0]
    return InboxEvent(id="evt-1", event_type="account_update", payload=change, attempts=1)


@pytest.mark.asyncio
async def test_a_send_rejected_because_the_number_is_gone_says_so_and_marks_the_disconnection(monkeypatch):
    saved, alert = _settings(monkeypatch)
    _mock_config(monkeypatch)
    _rejecting_client(monkeypatch, NUMBER_GONE)

    with pytest.raises(meta_service.WhatsAppDisconnectedError) as excinfo:
        await meta_service.send_message("lead-1", {"type": "text", "text": {"body": "hola"}})

    # Antes decía "Prueba de nuevo en unos segundos", y reintentar no sirve.
    assert describe_send_failure(excinfo.value, "enviar el mensaje a WhatsApp") == meta_service.DISCONNECTED_MESSAGE
    assert not is_transient_send_failure(excinfo.value)
    assert list(saved[0]) == [meta_service.DISCONNECTED_AT_KEY]
    assert datetime.fromisoformat(saved[0][meta_service.DISCONNECTED_AT_KEY]).tzinfo is not None
    assert alert.await_args.kwargs["event_type"] == "whatsapp_disconnected"


@pytest.mark.asyncio
async def test_an_attachment_rejected_because_the_number_is_gone_marks_the_disconnection(monkeypatch):
    saved, _alert = _settings(monkeypatch)
    _mock_config(monkeypatch)
    _rejecting_client(monkeypatch, NUMBER_GONE)

    with pytest.raises(meta_service.WhatsAppDisconnectedError):
        await meta_service.upload_media(b"bytes", "image/jpeg", "foto.jpg")

    assert meta_service.DISCONNECTED_AT_KEY in saved[0]


@pytest.mark.asyncio
async def test_a_content_rejection_with_the_same_code_is_not_a_disconnection(monkeypatch):
    saved, alert = _settings(monkeypatch)
    _mock_config(monkeypatch)
    _rejecting_client(monkeypatch, {"error": {"message": "Invalid parameter", "type": "OAuthException", "code": 100}})

    with pytest.raises(meta_service.MetaApiError) as excinfo:
        await meta_service.send_message("lead-1", {"type": "text", "text": {"body": "hola"}})

    assert not isinstance(excinfo.value, meta_service.WhatsAppDisconnectedError)
    assert saved == []
    alert.assert_not_awaited()


@pytest.mark.asyncio
async def test_losing_the_notice_number_does_not_disconnect_the_crm(monkeypatch):
    saved, _alert = _settings(monkeypatch)
    _mock_config(monkeypatch)
    _rejecting_client(monkeypatch, NUMBER_GONE)

    with pytest.raises(meta_service.MetaApiError) as excinfo:
        await meta_service.send_message_to_number(
            "51906471403", {"type": "text", "text": {"body": "hola"}}, sender_phone_number_id="AVISOS",
        )

    assert not isinstance(excinfo.value, meta_service.WhatsAppDisconnectedError)
    assert saved == []


@pytest.mark.asyncio
async def test_the_disconnection_keeps_the_time_of_the_first_notice(monkeypatch):
    first = "2026-11-21T03:51:41+00:00"
    saved, alert = _settings(monkeypatch, **{meta_service.DISCONNECTED_AT_KEY: first})

    assert await meta_service.mark_disconnected() is False

    assert saved == []
    alert.assert_not_awaited()
    assert await meta_service.disconnected_since() == datetime(2026, 11, 21, 3, 51, 41, tzinfo=timezone.utc)


@pytest.mark.asyncio
@pytest.mark.parametrize("event", ["PARTNER_REMOVED", "PARTNER_APP_UNINSTALLED"])
async def test_meta_announcing_the_crm_account_was_unlinked_marks_the_disconnection(monkeypatch, event):
    monkeypatch.setattr(processor, "get_effective_many", AsyncMock(return_value={"meta_waba_id": WABA_ID}))
    mark = AsyncMock(return_value=True)
    monkeypatch.setattr(processor.meta_service, "mark_disconnected", mark)

    await processor.process_change(_account_event(event))

    mark.assert_awaited_once_with()


@pytest.mark.asyncio
async def test_unlinking_the_notice_number_account_leaves_the_crm_connected(monkeypatch):
    monkeypatch.setattr(processor, "get_effective_many", AsyncMock(return_value={"meta_waba_id": WABA_ID}))
    mark = AsyncMock()
    monkeypatch.setattr(processor.meta_service, "mark_disconnected", mark)

    await processor.process_change(_account_event("PARTNER_REMOVED", waba_id="OTRA_WABA"))

    mark.assert_not_awaited()


@pytest.mark.asyncio
async def test_other_account_events_are_ignored_without_looking_for_a_business(monkeypatch):
    """El alta de una cuenta avisa por este mismo field cuando su WABA todavía
    no es de ningún negocio: buscarlo dejaría el evento fallando en el inbox."""
    tenant_for = AsyncMock(side_effect=AssertionError("no debe buscar el negocio"))
    monkeypatch.setattr(processor, "_tenant_for", tenant_for)
    mark = AsyncMock()
    monkeypatch.setattr(processor.meta_service, "mark_disconnected", mark)

    await processor.process_change(_account_event("PARTNER_APP_INSTALLED"))

    mark.assert_not_awaited()


@pytest.mark.asyncio
async def test_the_unlinked_account_is_routed_by_its_waba_and_not_by_the_entry(monkeypatch):
    """En ``account_update`` el ``entry.id`` es el portfolio del negocio."""
    asked: list[str] = []

    async def fake_resolve(waba_id):
        asked.append(waba_id)
        return None

    monkeypatch.setattr(processor.settings, "multitenancy_enabled", True)
    monkeypatch.setattr(processor, "resolve_tenant_by_waba_id", fake_resolve)
    mark = AsyncMock()
    monkeypatch.setattr(processor.meta_service, "mark_disconnected", mark)

    # Una WABA de ningún negocio activo: se da por recibido, sin reintentos.
    await processor.process_change(_account_event("PARTNER_REMOVED"))

    assert asked == [WABA_ID]
    mark.assert_not_awaited()


@pytest.mark.asyncio
async def test_status_reports_the_disconnection_while_the_credentials_are_still_saved(monkeypatch):
    since = datetime(2026, 11, 21, 3, 51, 41, tzinfo=timezone.utc)
    monkeypatch.setattr(whatsapp_api.meta_service, "is_configured", AsyncMock(return_value=True))
    monkeypatch.setattr(whatsapp_api.meta_service, "disconnected_since", AsyncMock(return_value=since))

    assert await whatsapp_api.whatsapp_status() == {
        "state": "disconnected", "instance": None, "disconnected_at": since,
    }

    monkeypatch.setattr(whatsapp_api.meta_service, "disconnected_since", AsyncMock(return_value=None))
    assert await whatsapp_api.whatsapp_status() == {"state": "open", "instance": None}


def _stored_settings(monkeypatch, current: dict[str, str]):
    upsert = AsyncMock()
    monkeypatch.setattr(settings_service.settings_repository, "upsert_values", upsert)
    monkeypatch.setattr(settings_service, "get_effective_many", AsyncMock(
        side_effect=lambda keys: {key: current.get(key, "") for key in keys},
    ))
    return upsert


@pytest.mark.asyncio
async def test_pasting_new_credentials_by_hand_closes_the_disconnection(monkeypatch):
    upsert = _stored_settings(monkeypatch, {"meta_phone_number_id": "VIEJO", "meta_waba_id": "WABA"})

    await settings_service.update_settings({"meta_phone_number_id": "NUEVO"})

    assert upsert.await_args.args[0] == {"meta_phone_number_id": "NUEVO", "meta_disconnected_at": None}


@pytest.mark.asyncio
async def test_saving_the_same_credentials_again_does_not_close_the_disconnection(monkeypatch):
    """El formulario de claves de Meta también guarda el catálogo y los Flows."""
    upsert = _stored_settings(monkeypatch, {"meta_phone_number_id": "VIEJO", "meta_waba_id": "WABA"})

    await settings_service.update_settings({"meta_phone_number_id": "VIEJO", "meta_catalog_id": "CAT"})

    assert "meta_disconnected_at" not in upsert.await_args.args[0]


@pytest.mark.asyncio
async def test_the_first_steps_checklist_reopens_whatsapp_while_disconnected(monkeypatch):
    values = {
        "meta_access_token": "t", "meta_phone_number_id": "p", "meta_waba_id": "w",
        "meta_disconnected_at": "2026-11-21T03:51:41+00:00",
        "google_calendar_refresh_token": "", onboarding.DISMISSED_KEY: "",
    }
    monkeypatch.setattr(onboarding, "get_effective_many", AsyncMock(return_value=values))
    monkeypatch.setattr(onboarding, "team_summary", AsyncMock(return_value={"users": 2}))
    monkeypatch.setattr(onboarding, "onboarding_catalog_status", AsyncMock(
        return_value={"priced_services": 1, "templates_customized": True},
    ))

    steps = {step["key"]: step["done"] for step in (await onboarding.onboarding_status())["steps"]}

    assert steps["whatsapp"] is False
