"""Compras del lead con el repositorio en memoria: copia del paquete, monto,
auditoría, eventos, borrado y el cierre que mueve y registra a la vez."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.leads.application import sales
from app.modules.leads.application.sales import SaleInput
from app.modules.leads.domain.errors import LeadNotFound, PackageNotAvailable, SaleNotEditable, SaleNotFound
from app.modules.leads.domain.events import LeadSaleChanged, LeadStageChanged
from app.modules.leads.domain.lead import Actor
from app.modules.leads import api as leads_api
from app.modules.leads.schemas import LeadSaleCreate, LeadStageUpdate

SELLER = Actor.user(7)
ADMIN = Actor.user(1)

PACKAGE = {
    "service_id": 3, "service_name": "Hollywood Peel - Rostro",
    "package_id": 30, "package_name": "x3", "sessions": 3, "price": Decimal("400"),
}


async def catalog(service_id, package_id):
    return dict(PACKAGE) if (service_id, package_id) == (3, 30) else None


async def test_recording_a_sale_copies_the_package_and_defaults_to_list_price(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed()

    row = await sales.record_sale(lead_id, SaleInput(service_id=3, package_id=30), actor=SELLER, lookup_package=catalog)

    assert (row["service_name"], row["package_name"], row["sessions"]) == ("Hollywood Peel - Rostro", "x3", 3)
    assert row["list_price"] == Decimal("400.00") and row["amount"] == Decimal("400.00")
    assert row["sold_by_user_id"] == 7 and row["created_by_user_id"] == 7
    assert isinstance(row["sold_at"], datetime)
    [record] = repo.audit(lead_id)
    assert record.event_type == "sale_recorded"
    assert record.new_value == {
        "sale_id": 1, "service": "Hollywood Peel - Rostro", "package": "x3",
        "sessions": 3, "amount": "400.00", "list_price": "400.00",
    }
    [event] = in_memory_leads.published
    assert isinstance(event, LeadSaleChanged) and event.sale_id == 1 and event.deleted is False


async def test_a_discount_keeps_the_list_price_for_reference(in_memory_leads):
    lead_id = in_memory_leads.repository.seed()
    when = datetime(2026, 11, 1, 15, 0, tzinfo=timezone.utc)

    row = await sales.record_sale(
        lead_id, SaleInput(service_id=3, package_id=30, amount=Decimal("350"), notes="  Promo   noviembre ", sold_at=when),
        actor=SELLER, lookup_package=catalog,
    )

    assert (row["amount"], row["list_price"]) == (Decimal("350.00"), Decimal("400.00"))
    assert row["notes"] == "Promo   noviembre"
    assert row["sold_at"] == when


async def test_a_package_that_is_no_longer_sold_is_rejected(in_memory_leads):
    lead_id = in_memory_leads.repository.seed()

    with pytest.raises(PackageNotAvailable):
        await sales.record_sale(lead_id, SaleInput(service_id=3, package_id=99), actor=SELLER, lookup_package=catalog)
    assert in_memory_leads.repository.audit(lead_id) == []


async def test_recording_needs_an_existing_lead(in_memory_leads):
    with pytest.raises(LeadNotFound):
        await sales.record_sale("nope", SaleInput(service_id=3, package_id=30), actor=SELLER, lookup_package=catalog)


async def test_only_the_seller_or_an_admin_deletes_a_sale(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed()
    row = await sales.record_sale(lead_id, SaleInput(service_id=3, package_id=30), actor=SELLER, lookup_package=catalog)

    with pytest.raises(SaleNotEditable):
        await sales.delete_sale(lead_id, row["id"], actor=Actor.user(8), is_admin=False)
    assert await repo.get_sale(lead_id, row["id"]) is not None

    await sales.delete_sale(lead_id, row["id"], actor=ADMIN, is_admin=True)

    assert await repo.get_sale(lead_id, row["id"]) is None
    assert [record.event_type for record in repo.audit(lead_id)] == ["sale_recorded", "sale_deleted"]
    assert repo.audit(lead_id)[1].old_value["package"] == "x3"
    assert in_memory_leads.published[-1] == LeadSaleChanged(lead_id=lead_id, actor=ADMIN, sale_id=row["id"], deleted=True)

    with pytest.raises(SaleNotFound):
        await sales.delete_sale(lead_id, row["id"], actor=ADMIN, is_admin=True)


async def test_closing_with_a_sale_moves_the_lead_and_records_the_purchase(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed(stage="calificado")

    row = await sales.close_with_sale(lead_id, "cliente_activo", SaleInput(service_id=3, package_id=30), actor=SELLER, lookup_package=catalog)

    assert repo.column(lead_id, "estado") == "cliente_activo"
    assert row["package_name"] == "x3"
    assert [record.event_type for record in repo.audit(lead_id)] == ["stage_changed", "sale_recorded"]
    assert [type(event) for event in in_memory_leads.published] == [LeadStageChanged, LeadSaleChanged]


async def test_closing_with_an_unavailable_package_moves_nothing(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed(stage="calificado")

    with pytest.raises(PackageNotAvailable):
        await sales.close_with_sale(lead_id, "cliente_activo", SaleInput(service_id=3, package_id=99), actor=SELLER, lookup_package=catalog)

    # El cambio de etapa quedó en la misma unidad de trabajo que falló: no
    # se publicó ni se confirmó nada.
    assert in_memory_leads.published == []


async def test_stage_route_closes_with_sale_when_the_body_brings_one(monkeypatch):
    received = {}

    async def fake_close(chat_id, stage, sale, *, actor):
        received.update(chat_id=chat_id, stage=stage, sale=sale, actor=actor)
        return {}

    async def fake_change(*_args, **_kwargs):
        raise AssertionError("no debió mover sin venta")

    async def fake_chat(_chat_id):
        return {"chat_id": "lead-1"}

    monkeypatch.setattr(leads_api.sales, "close_with_sale", fake_close)
    monkeypatch.setattr(leads_api.commands, "change_stage", fake_change)
    monkeypatch.setattr(leads_api, "_chat_or_404", fake_chat)

    await leads_api.move_chat_stage(
        "lead-1",
        LeadStageUpdate(stage="cliente_activo", sale=LeadSaleCreate(service_id=3, package_id=30, amount=Decimal("350"))),
        SimpleNamespace(id=7, role="vendedor"),
    )

    assert received["stage"] == "cliente_activo"
    assert received["sale"] == SaleInput(service_id=3, package_id=30, amount=Decimal("350"), notes=None, sold_at=None)
    assert received["actor"] == SELLER


def test_sale_amount_cannot_be_negative():
    with pytest.raises(ValueError):
        LeadSaleCreate(service_id=1, package_id=1, amount=Decimal("-1"))
