"""Lo que llega de la app WhatsApp Business del celular contra PostgreSQL:
los contactos esperan a que alguien elija (salvo importación automática), los
cambios se aplican en orden, y el historial permite elegir "los que
conversaron en los últimos N días", como ManyChat."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.modules.contacts import import_service, sync_service
from app.modules.contacts.queries import batch_summary, list_contacts, whatsapp_sync_status
from app.modules.contacts.types import SelectionMode
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401

PN = "PN-CRM"


async def _phones() -> set[str]:
    return {item["telefono"] for item in (await list_contacts(limit=200))["items"]}


def _state(action: str, *, user_id: str, phone: str | None = None, name: str | None = None, ts: int = 1_700_000_000):
    contact = {"user_id": user_id}
    if phone:
        contact["phone_number"] = phone
    if name:
        contact["full_name"] = name
    return {"state_sync": [{"type": "contact", "action": action, "contact": contact, "metadata": {"timestamp": str(ts)}}]}


def _history(*threads: tuple[str, datetime], progress: int = 100):
    return {"history": [{
        "metadata": {"phase": 0, "chunk_order": 1, "progress": progress},
        "threads": [
            {"id": phone, "messages": [{"from": phone, "timestamp": str(int(at.timestamp()))}]}
            for phone, at in threads
        ],
    }]}


async def test_phone_contacts_wait_for_review_unless_auto_import_is_on(tenant):
    with tenant_context(tenant):
        await sync_service.apply_app_contacts(PN, _state("add", user_id="US.1", phone="51987000020", name="Fer"))
        assert await _phones() == set()
        status = await whatsapp_sync_status()
        assert status["open_batch_id"]
        summary = await batch_summary(status["open_batch_id"])
        assert summary["source"] == "whatsapp_app"
        assert summary["counts"]["pending"] == 1

        # Un "remove" de alguien que solo esperaba lo saca de la lista.
        await sync_service.apply_app_contacts(PN, _state("remove", user_id="US.1", ts=1_700_000_100))
        assert (await batch_summary(status["open_batch_id"]))["counts"]["pending"] == 0

        await sync_service.set_auto_import(True)
        await sync_service.apply_app_contacts(PN, _state("add", user_id="US.2", phone="51987000021", name="Gabi"))
        [gabi] = (await list_contacts())["items"]
        assert (gabi["nombre"], gabi["origen"]) == ("Gabi", "whatsapp_app")


async def test_phone_changes_update_known_contacts_in_order(tenant):
    with tenant_context(tenant):
        await sync_service.set_auto_import(True)
        await sync_service.apply_app_contacts(PN, _state("add", user_id="US.3", phone="51987000030", name="Hugo", ts=100))
        await sync_service.apply_app_contacts(PN, _state("add", user_id="US.3", name="Hugo Pérez", ts=300))
        # Llega tarde un cambio más viejo: no deshace el nuevo.
        await sync_service.apply_app_contacts(PN, _state("add", user_id="US.3", name="Huguito", ts=200))
        [hugo] = (await list_contacts())["items"]
        assert hugo["nombre"] == "Hugo Pérez"

        await sync_service.apply_app_contacts(PN, _state("remove", user_id="US.3", ts=400))
        [hugo] = (await list_contacts())["items"]
        assert hugo["eliminado_en_app_at"] is not None


async def test_history_offers_people_who_chatted_recently(tenant):
    now = datetime.now(timezone.utc)
    with tenant_context(tenant):
        await sync_service.apply_history(PN, _history(
            ("51987000040", now - timedelta(hours=3)),
            ("51987000041", now - timedelta(days=20)),
            ("51987000042", now - timedelta(days=120)),
        ))
        status = await whatsapp_sync_status()
        [history] = [sync for sync in status["syncs"] if sync["sync_type"] == "history"]
        assert history["status"] == "done"
        summary = await batch_summary(status["open_batch_id"])
        assert {item["days"]: item["count"] for item in summary["recent"]} == {1: 1, 7: 1, 30: 2, 90: 2, 180: 3}

        result = await import_service.confirm_import(
            status["open_batch_id"], import_service.Selection(mode=SelectionMode.RECENT, days=30),
        )

        assert result["created"] == 2
        assert await _phones() == {"51987000040", "51987000041"}


async def test_history_declined_is_reported(tenant):
    with tenant_context(tenant):
        await sync_service.apply_history(PN, {"history": [{"errors": [{"code": 2593109}]}]})
        [history] = (await whatsapp_sync_status())["syncs"]
        assert history["status"] == "declined"


async def test_sync_status_shows_only_the_current_number(tenant):
    # DermicaPro dejó la app del celular: lo pedido para el número anterior
    # hacía decir que la agenda seguía llegando.
    with tenant_context(tenant):
        await sync_service.record_sync_request("PN-VIEJO", "smb_app_state_sync", request_id="r1", error=None)
        assert (await whatsapp_sync_status("PN-NUEVO"))["syncs"] == []
        [old] = (await whatsapp_sync_status("PN-VIEJO"))["syncs"]
        assert old["phone_number_id"] == "PN-VIEJO"


async def test_sync_request_records_the_meta_window(tenant):
    with tenant_context(tenant):
        await sync_service.record_sync_request(PN, "smb_app_state_sync", request_id=None, error="Meta dijo no")
        assert await sync_service.syncs_to_retry(PN) == ["smb_app_state_sync"]

        old = datetime.now(timezone.utc) - timedelta(days=2)
        await sync_service.record_sync_request(
            PN, "smb_app_state_sync", request_id=None, error="Meta dijo no", window_started_at=old,
        )
        assert await sync_service.syncs_to_retry(PN) == []
