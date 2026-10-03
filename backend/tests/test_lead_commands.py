"""Casos de uso del lead con un repositorio en memoria: reglas y eventos."""

from __future__ import annotations

import pytest

from app.modules.leads.application import commands
from app.modules.leads.domain.errors import (
    InvalidLeadStageError,
    LeadAlreadyExists,
    LeadNotFound,
    SellerNotFound,
    TagNotAvailable,
)
from app.modules.leads.domain.events import (
    ConversationStarted,
    LeadCreated,
    LeadDeleted,
    LeadNoShowRegistered,
    LeadStageChanged,
    LeadsMerged,
    LeadTagged,
    LeadUpdated,
)
from app.modules.leads.domain.lead import Actor, TriggerMessage

SELLER = Actor.user(7)


# --- Cambio de etapa ------------------------------------------------------


async def test_moving_a_lead_audits_and_publishes_the_change(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed()
    repo.messages[lead_id] = TriggerMessage(9, "Quiero agendar", "2026-07-20T15:00:00.000000Z")

    result = await commands.change_stage(lead_id, "calificado", actor=SELLER, metadata={"source": "kanban"})

    assert result.changed is True
    assert repo.column(lead_id, "estado") == "calificado"
    [record] = repo.audit(lead_id)
    assert (record.event_type, record.actor) == ("stage_changed", SELLER)
    assert (record.old_value, record.new_value) == ({"stage": "nuevo"}, {"stage": "calificado"})
    assert record.metadata["source"] == "kanban"
    assert record.metadata["trigger_message"]["content"] == "Quiero agendar"
    [event] = in_memory_leads.published
    assert isinstance(event, LeadStageChanged)
    assert (event.old_stage, event.new_stage, event.activity_id) == ("nuevo", "calificado", 1)
    assert event.triggers_automations is True


async def test_staying_in_the_same_stage_changes_nothing(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed(stage="archivada")

    # Ni siquiera valida: un lead puede seguir en una etapa desactivada.
    result = await commands.change_stage(lead_id, "archivada", actor=SELLER)

    assert result.changed is False
    assert repo.audit() == []
    assert in_memory_leads.published == []


@pytest.mark.parametrize("stage", ["inventada", "archivada"])
async def test_nobody_moves_a_lead_to_an_unknown_or_inactive_stage(in_memory_leads, stage):
    lead_id = in_memory_leads.repository.seed()

    with pytest.raises(InvalidLeadStageError):
        await commands.change_stage(lead_id, stage, actor=SELLER)

    assert in_memory_leads.published == []


async def test_the_lost_reason_follows_the_stage_kind(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed()

    await commands.change_stage(lead_id, "perdido", actor=SELLER, lost_reason="  Precio ")
    assert repo.column(lead_id, "razon_perdido") == "Precio"
    assert repo.audit(lead_id)[-1].metadata["reason"] == "Precio"

    await commands.change_stage(lead_id, "calificado", actor=SELLER)
    assert repo.column(lead_id, "razon_perdido") is None


async def test_an_automation_move_does_not_retrigger_automations(in_memory_leads):
    lead_id = in_memory_leads.repository.seed()

    await commands.change_stage(lead_id, "calificado", actor=Actor.system(), triggers_automations=False)

    [event] = in_memory_leads.published
    assert event.triggers_automations is False


async def test_a_missing_lead_cannot_be_moved(in_memory_leads):
    with pytest.raises(LeadNotFound):
        await commands.change_stage("no-existe", "calificado", actor=SELLER)


# --- Alta y edición -------------------------------------------------------


async def test_a_new_lead_starts_in_the_initial_stage_and_is_announced(in_memory_leads):
    repo = in_memory_leads.repository

    lead_id = await commands.create_lead("51911111111", "Ana", actor=SELLER, vendedor_id=7)

    assert repo.column(lead_id, "estado") == "nuevo"
    assert repo.column(lead_id, "vendedor") == "Luis"
    [record] = repo.audit(lead_id)
    assert (record.event_type, record.new_value) == ("lead_created", {"name": "Ana", "phone": "51911111111"})
    [event] = in_memory_leads.published
    assert isinstance(event, LeadCreated) and event.activity_id == 1


async def test_a_lead_needs_an_active_seller(in_memory_leads):
    with pytest.raises(SellerNotFound):
        await commands.create_lead("51911111111", "Ana", actor=SELLER, vendedor_id=99)


async def test_a_phone_belongs_to_one_lead(in_memory_leads):
    await commands.create_lead("51911111111", "Ana", actor=SELLER)
    with pytest.raises(LeadAlreadyExists):
        await commands.create_lead("51911111111", "Otra", actor=SELLER)


async def test_updating_audits_only_what_changed(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed(nombre="Ana", notas="vieja")

    changes = await commands.update_lead(lead_id, {"nombre": "Ana", "notas": "nueva"}, actor=SELLER)

    assert changes.fields == ("notas",)
    [record] = repo.audit(lead_id)
    assert (record.old_value, record.new_value) == ({"notas": "vieja"}, {"notas": "nueva"})
    [event] = in_memory_leads.published
    assert isinstance(event, LeadUpdated) and event.values == {"notas": "nueva"}


async def test_nothing_to_change_publishes_nothing(in_memory_leads):
    lead_id = in_memory_leads.repository.seed(nombre="Ana")

    assert await commands.update_lead(lead_id, {"nombre": "Ana"}, actor=SELLER) is None
    assert in_memory_leads.published == []


async def test_opening_a_conversation_starts_a_new_version(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed(conversacion_abierta=False, conversacion_version=2)

    changes = await commands.update_lead(lead_id, {"conversacion_abierta": True}, actor=SELLER)

    assert changes.event_type == "conversation_opened"
    assert repo.column(lead_id, "conversacion_version") == 3
    assert repo.column(lead_id, "conversacion_cerrada_at") is None

    closed = await commands.update_lead(lead_id, {"conversacion_abierta": False}, actor=SELLER)
    assert closed.event_type == "conversation_closed"
    assert repo.column(lead_id, "conversacion_cerrada_at") is not None


async def test_reassigning_mirrors_the_seller_name(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed(vendedor_id=None, vendedor=None)

    await commands.update_lead(lead_id, {"vendedor_id": 7}, actor=SELLER)
    assert repo.column(lead_id, "vendedor") == "Luis"

    with pytest.raises(SellerNotFound):
        await commands.update_lead(lead_id, {"vendedor_id": 99}, actor=SELLER)


async def test_editing_phone_and_fields_is_one_change(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed(nombre="Ana")

    await commands.edit_lead(lead_id, {"nombre": "Ana María"}, actor=SELLER, phone="51922222222")

    assert repo.column(lead_id, "telefono") == "51922222222"
    assert repo.column(lead_id, "nombre") == "Ana María"
    assert [r.new_value for r in repo.audit(lead_id)] == [{"phone": "51922222222"}, {"nombre": "Ana María"}]


async def test_a_phone_in_use_cannot_be_taken(in_memory_leads):
    repo = in_memory_leads.repository
    repo.seed("a", telefono="51911111111")
    repo.seed("b", telefono="51922222222")

    with pytest.raises(LeadAlreadyExists):
        await commands.change_phone("b", "51911111111", actor=SELLER)


# --- Etiquetas, no-show, borrado y fusión ----------------------------------


async def test_tags_are_assigned_once_and_audited(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed()

    await commands.assign_tag(lead_id, 1, actor=SELLER)
    await commands.assign_tag(lead_id, 1, actor=SELLER)
    await commands.remove_tag(lead_id, 1, actor=SELLER)

    assert [r.event_type for r in repo.audit(lead_id)] == ["tag_added", "tag_removed"]
    assert [(e.tag_id, e.added) for e in in_memory_leads.published if isinstance(e, LeadTagged)] == [(1, True), (1, False)]
    with pytest.raises(TagNotAvailable):
        await commands.remove_tag(lead_id, 1, actor=SELLER)
    with pytest.raises(TagNotAvailable):
        await commands.assign_tag(lead_id, 404, actor=SELLER)


async def test_each_no_show_adds_up(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed(contador_noshow=1)

    assert await commands.register_no_show(lead_id, actor=SELLER) == 2
    assert repo.column(lead_id, "contador_noshow") == 2
    assert isinstance(in_memory_leads.published[-1], LeadNoShowRegistered)


async def test_deleting_and_merging_are_announced(in_memory_leads):
    repo = in_memory_leads.repository
    repo.seed("a")
    repo.seed("b")

    await commands.merge_leads("b", "a", actor=SELLER)
    await commands.delete_lead("a", actor=SELLER)

    assert repo.merged == [("b", "a")]
    merged, deleted = in_memory_leads.published
    assert isinstance(merged, LeadsMerged) and merged.source_id == "b"
    assert isinstance(deleted, LeadDeleted)
    with pytest.raises(LeadNotFound):
        await commands.delete_lead("a", actor=SELLER)


async def test_an_inbound_message_opens_a_closed_conversation_only_once(in_memory_leads):
    repo = in_memory_leads.repository
    lead_id = repo.seed()

    first = await commands.open_conversation_from_inbound(lead_id, "wamid.1", "Hola")
    second = await commands.open_conversation_from_inbound(lead_id, "wamid.2", "¿Hola?")

    assert first == {"version": 1, "opened_at": "2026-07-20T15:00:00.000000Z"}
    assert second is None
    [record] = repo.audit(lead_id)
    assert record.event_type == "conversation_started"
    assert record.metadata == {"message_id": "wamid.1", "content": "Hola"}
    assert isinstance(in_memory_leads.published[0], ConversationStarted)


async def test_renaming_a_service_follows_on_every_lead(in_memory_leads):
    repo = in_memory_leads.repository
    repo.seed("a", servicio_interes=" Botox ")
    repo.seed("b", servicio_interes="Limpieza")

    await commands.rename_service("botox", "Toxina", actor=SELLER, service_id=3)

    assert repo.column("a", "servicio_interes") == "Toxina"
    assert repo.column("b", "servicio_interes") == "Limpieza"
    [record] = repo.audit("a")
    assert record.metadata == {"source": "service_catalog", "service_id": 3}
