"""Enviar plantilla que sigue según el botón de respuesta rápida que toque el
cliente: forma del paso, salidas, comprobación al publicar y motor.

El paso «Enviar plantilla de WhatsApp» tenía una sola salida aunque la
plantilla tuviera botones (reporte del 2026-11-27 sobre «Welcome Instagram»):
para separar rutas había que agregar una Espera y una Condición por botón.
"""

import dataclasses
from unittest.mock import AsyncMock

import pytest

from app.modules.automations.application import simulation
from app.modules.automations.application.engine import run_visual_execution
from app.modules.automations.application.validation import validate_visual_flow
from app.modules.automations.domain.errors import InvalidAutomation
from app.modules.automations.domain.flow_definition import dynamic_handles, normalize_flow, normalize_visual_draft
from app.modules.automations.domain.replies import match_question_button
from app.modules.automations.domain.templates import quick_reply_labels, reply_buttons_now
from app.modules.automations.domain.validation import normalize_template_reply
from tests.conftest import make_chat, make_execution, make_rule

SI_NO = [{"id": "btn_1", "label": "Sí, quiero"}, {"id": "btn_2", "label": "No, gracias"}]


def meta_template(*quick_replies, **overrides):
    return {
        "id": 5, "is_active": True, "interactive_type": "none", "attachments": [],
        "template_type": "official", "content": "Hola {{1}}", "official_name": "bienvenida",
        "official_language": "es", "official_status": "APPROVED", "official_parameter_values": ["{{nombre}}"],
        "official_header_type": "none", "official_header_text": None,
        "official_header_media_url": None, "official_header_media_filename": None, "official_footer": None,
        "official_buttons": [{"type": "quick_reply", "text": text} for text in quick_replies],
        **overrides,
    }


def _node(node_id, node_type, **data):
    return {"id": node_id, "type": node_type, "position": {"x": 0, "y": 0}, "data": data}


def _edge(source, target, handle="next"):
    return {"id": f"{source}-{handle}", "source": source, "target": target, "source_handle": handle}


def reply_flow(buttons=SI_NO, timeout_seconds=3600, handles=("btn_1", "btn_2", "other", "timeout")):
    """Inicio → plantilla con una salida por botón, cada una a su propio Fin."""
    return {
        "conditions": {},
        "nodes": [
            _node("t", "trigger", trigger_type="manual"),
            _node(
                "a", "action", action={"type": "send_template", "template_id": 5},
                reply={"buttons": buttons, "timeout_seconds": timeout_seconds},
            ),
            *[_node(f"end_{handle}", "end", label=handle) for handle in handles],
        ],
        "edges": [_edge("t", "a"), *[_edge("a", f"end_{handle}", handle) for handle in handles]],
    }


def saved(executions) -> list[dict]:
    return [values for _execution_id, values in executions.saves]


class TestNormalizeTemplateReply:
    def test_without_the_setting_the_step_is_untouched(self):
        assert normalize_template_reply(None) is None

    def test_buttons_get_positional_ids_like_the_question(self):
        assert normalize_template_reply({"buttons": ["Sí, quiero", {"id": "x", "label": " No, gracias "}], "timeout_seconds": 86400}) == {
            "buttons": SI_NO, "timeout_seconds": 86400,
        }

    def test_keeps_the_full_text_of_a_meta_button(self):
        # 25 caracteres: más que los 20 de un botón interactivo.
        label = "Quiero agendar mi cita ya"
        assert normalize_template_reply({"buttons": [label], "timeout_seconds": 60})["buttons"][0]["label"] == label

    def test_needs_at_least_one_button(self):
        with pytest.raises(InvalidAutomation, match="botones de respuesta rápida"):
            normalize_template_reply({"buttons": [], "timeout_seconds": 60})

    @pytest.mark.parametrize("seconds", [0, 604801, None])
    def test_timeout_between_one_second_and_seven_days(self, seconds):
        with pytest.raises(InvalidAutomation, match="entre 1 segundo y 7 días"):
            normalize_template_reply({"buttons": ["Sí"], "timeout_seconds": seconds})


class TestFlowShape:
    def test_a_step_without_the_setting_normalizes_exactly_as_before(self):
        flow = reply_flow(handles=("next",))
        del flow["nodes"][1]["data"]["reply"]
        normalized = normalize_flow("Bienvenida", flow)
        assert normalized.nodes[1]["data"] == {"action": {"type": "send_template", "template_id": 5}}
        assert normalized.template_replies == []

    def test_the_setting_is_kept_and_reported_for_the_publish_check(self):
        normalized = normalize_flow("Bienvenida", reply_flow())
        assert normalized.nodes[1]["data"]["reply"] == {"buttons": SI_NO, "timeout_seconds": 3600}
        [ref] = normalized.template_replies
        assert (ref.node_id, ref.template_id, ref.labels) == ("a", 5, ("Sí, quiero", "No, gracias"))

    def test_only_a_template_step_can_follow_by_button(self):
        flow = reply_flow()
        flow["nodes"][1]["data"]["action"] = {"type": "send_message", "text": "Hola"}
        with pytest.raises(InvalidAutomation, match="Solo «Enviar plantilla de WhatsApp»") as error:
            normalize_flow("Bienvenida", flow)
        assert error.value.node_id == "a"

    def test_outputs_are_the_buttons_plus_other_and_timeout(self):
        assert dynamic_handles("action", reply_flow()["nodes"][1]["data"]) == {"btn_1", "btn_2", "other", "timeout"}
        assert dynamic_handles("action", {"action": {"type": "send_template", "template_id": 5}}) == set()

    def test_the_draft_can_be_saved_with_button_connections(self):
        draft = normalize_visual_draft("Bienvenida", reply_flow())
        assert {edge["source_handle"] for edge in draft["flow_definition"]["edges"]} == {
            "next", "btn_1", "btn_2", "other", "timeout",
        }


class TestPublish:
    async def test_every_output_must_be_connected(self, in_memory_automations):
        in_memory_automations.references.quick_replies[5] = ["Sí, quiero", "No, gracias"]
        with pytest.raises(InvalidAutomation, match="cada botón de la plantilla") as error:
            await validate_visual_flow("Bienvenida", reply_flow(handles=("btn_1", "btn_2", "other")))
        assert error.value.node_id == "a"

    async def test_next_is_no_longer_an_output(self, in_memory_automations):
        in_memory_automations.references.quick_replies[5] = ["Sí, quiero", "No, gracias"]
        with pytest.raises(InvalidAutomation, match="cada botón de la plantilla"):
            await validate_visual_flow("Bienvenida", reply_flow(handles=("next",)))

    async def test_publishes_when_the_template_still_has_those_buttons(self, in_memory_automations):
        in_memory_automations.references.quick_replies[5] = ["Sí, quiero", "No, gracias"]
        validated = await validate_visual_flow("Bienvenida", reply_flow())
        assert validated["flow_definition"]["nodes"][1]["data"]["reply"]["buttons"] == SI_NO

    @pytest.mark.parametrize("current", [
        ["Sí, quiero"],                        # perdió un botón
        ["No, gracias", "Sí, quiero"],         # cambió el orden
        ["Sí, quiero", "Ahora no"],            # cambió un texto
        [],                                    # ya no tiene respuestas rápidas
    ])
    async def test_rejects_a_template_whose_buttons_changed(self, in_memory_automations, current):
        if current:
            in_memory_automations.references.quick_replies[5] = current
        with pytest.raises(InvalidAutomation, match="Actualizar botones") as error:
            await validate_visual_flow("Bienvenida", reply_flow())
        assert error.value.node_id == "a"

    async def test_a_template_with_buttons_still_publishes_through_next(self, in_memory_automations):
        # Lo que ya estaba publicado: plantilla con botones y una sola salida.
        in_memory_automations.references.quick_replies[5] = ["Sí, quiero", "No, gracias"]
        flow = reply_flow(handles=("next",))
        del flow["nodes"][1]["data"]["reply"]
        validated = await validate_visual_flow("Bienvenida", flow)
        assert "reply" not in validated["flow_definition"]["nodes"][1]["data"]


class TestQuickReplies:
    def test_only_quick_reply_buttons_of_a_meta_template_count(self):
        template = meta_template("Sí", official_buttons=[
            {"type": "quick_reply", "text": "Sí"}, {"type": "url", "text": "Ver", "url": "https://x.pe"},
        ])
        assert quick_reply_labels(template) == ["Sí"]
        assert quick_reply_labels({**template, "template_type": "internal"}) == []
        assert quick_reply_labels(None) == []

    def test_todays_buttons_keep_the_output_of_the_saved_one_with_the_same_text(self):
        stored = [{"id": "btn_1", "label": "Sí"}, {"id": "btn_2", "label": "No"}, {"id": "btn_3", "label": "Tal vez"}]
        # Quitaron «No»: «Tal vez» no hereda su salida por estar segundo.
        assert reply_buttons_now(stored, ["Sí", "Tal vez", "Llámenme"]) == [
            {"id": "btn_1", "label": "Sí"}, {"id": "btn_3", "label": "Tal vez"}, {"id": "unmapped_3", "label": "Llámenme"},
        ]

    def test_without_buttons_today_the_saved_ones_are_used(self):
        assert reply_buttons_now(SI_NO, []) == SI_NO

    def test_the_tap_of_a_template_button_matches_by_its_text(self):
        # Meta manda el texto del botón como contenido y, sin payload propio,
        # también como identificador: no es ninguno de nuestros ids.
        assert match_question_button(SI_NO, "No, gracias", "No, gracias") == "btn_2"


class TestEngine:
    @staticmethod
    def with_template(deps, *quick_replies):
        return dataclasses.replace(deps, load_template=AsyncMock(return_value=meta_template(*quick_replies)))

    @staticmethod
    def waiting(**state):
        return make_execution(flow_state={
            "definition": reply_flow(), "flow_version": 0, "current_node_id": "a", "path": ["t", "a"],
            "waiting_at_node": "a", "waiting_since": "2026-11-27T00:00:00+00:00", "awaiting": ["message"],
            "question_buttons": SI_NO, **state,
        })

    async def test_sends_the_template_and_waits_for_the_answer(self, deps, outbox, executions, frozen_now):
        execution = make_execution(flow_state={
            "definition": reply_flow(), "flow_version": 0, "current_node_id": "a", "path": ["t"],
        })

        await run_visual_execution(
            execution, make_rule(flow_version=0), make_chat(), self.with_template(deps, "Sí, quiero", "No, gracias"),
        )

        [(_chat_id, [item])] = outbox.enqueued
        assert item["message"]["type"] == "template"
        [persisted] = saved(executions)
        assert persisted["status"] == "scheduled"
        state = persisted["flow_state"]
        assert state["current_node_id"] == "a"
        assert state["waiting_at_node"] == "a"
        assert state["awaiting"] == ["message"]
        assert state["question_buttons"] == SI_NO
        [result] = persisted["action_results"]
        assert (result["type"], result["status"], result["template_id"]) == ("send_template", "completed", 5)

    async def test_waits_the_configured_time(self, deps, executions):
        from datetime import datetime, timezone

        execution = make_execution(flow_state={
            "definition": reply_flow(timeout_seconds=7200), "flow_version": 0, "current_node_id": "a", "path": ["t"],
        })
        before = datetime.now(timezone.utc)

        await run_visual_execution(execution, make_rule(flow_version=0), make_chat(), self.with_template(deps, "Sí, quiero"))

        waited = (saved(executions)[0]["scheduled_for"] - before).total_seconds()
        assert 7199 <= waited <= 7205

    async def test_does_not_send_again_when_it_resumes(self, deps, outbox, executions):
        await run_visual_execution(
            self.waiting(resume_reason="btn_2"), make_rule(flow_version=0), make_chat(),
            self.with_template(deps, "Sí, quiero", "No, gracias"),
        )

        assert outbox.enqueued == []
        final = saved(executions)[-1]
        assert final["status"] == "completed"
        assert final["flow_state"]["path"] == ["t", "a", "a", "end_btn_2"]
        assert [(step["type"], step.get("branch")) for step in final["action_results"]] == [
            ("send_template", "btn_2"), ("end", None),
        ]

    @pytest.mark.parametrize("resume_reason,end", [
        ("btn_1", "end_btn_1"),      # tocó el botón
        ("other", "end_other"),      # escribió otra cosa
        (None, "end_timeout"),       # no respondió a tiempo
        ("unmapped_3", "end_other"), # botón que la plantilla sumó después de publicar
        ("message", "end_other"),    # la plantilla ya no tenía botones al enviarse
    ])
    async def test_follows_the_branch_of_the_answer(self, deps, executions, resume_reason, end):
        state = {"resume_reason": resume_reason} if resume_reason else {}

        await run_visual_execution(self.waiting(**state), make_rule(flow_version=0), make_chat(), deps)

        assert saved(executions)[-1]["flow_state"]["path"][-1] == end

    async def test_a_template_that_lost_a_button_keeps_each_text_on_its_own_output(self, deps, executions):
        # Publicada con «Sí, quiero / No, gracias»; hoy la plantilla solo tiene
        # «No, gracias», que sigue saliendo por la salida que se armó para él.
        execution = make_execution(flow_state={
            "definition": reply_flow(), "flow_version": 0, "current_node_id": "a", "path": ["t"],
        })

        await run_visual_execution(execution, make_rule(flow_version=0), make_chat(), self.with_template(deps, "No, gracias"))

        buttons = saved(executions)[0]["flow_state"]["question_buttons"]
        assert buttons == [{"id": "btn_2", "label": "No, gracias"}]
        assert match_question_button(buttons, "No, gracias", "No, gracias") == "btn_2"
        assert match_question_button(buttons, "Sí, quiero", "Sí, quiero") == "other"

    async def test_a_template_step_without_the_setting_goes_straight_on(self, deps, outbox, executions):
        flow = reply_flow(handles=("next",))
        del flow["nodes"][1]["data"]["reply"]
        execution = make_execution(flow_state={"definition": flow, "flow_version": 0, "current_node_id": "a", "path": ["t"]})

        await run_visual_execution(execution, make_rule(flow_version=0), make_chat(), self.with_template(deps, "Sí, quiero"))

        assert len(outbox.enqueued) == 1
        final = saved(executions)[-1]
        assert final["status"] == "completed"
        assert final["flow_state"]["path"] == ["t", "a", "end_next"]


async def test_the_simulation_follows_no_answer(in_memory_automations, deps, monkeypatch):
    flow = reply_flow()
    in_memory_automations.rules.rules[1] = {"id": 1, "name": "Bienvenida", "flow_definition": flow, "flow_version": 1}
    monkeypatch.setattr(simulation, "validate_visual_flow", AsyncMock(return_value={"conditions": {}, "flow_definition": flow}))
    simulator = dataclasses.replace(
        deps, fetch_chat=AsyncMock(return_value=make_chat()), load_template=AsyncMock(return_value=meta_template("Sí, quiero")),
    )

    result = await simulation.simulate_visual_flow(1, "lead-1", simulator)

    assert [(step["node_id"], step["type"], step["status"], step.get("branch")) for step in result["path"]] == [
        ("t", "trigger", "matched", None),
        ("a", "send_template", "would_run", "timeout"),
        ("end_timeout", "end", "completed", None),
    ]
