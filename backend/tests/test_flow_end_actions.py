"""Acciones opcionales que se ejecutan al llegar a un bloque Fin."""

from app.modules.automations.application.engine import run_visual_execution
from app.modules.automations.application.validation import validate_visual_flow
from tests.conftest import make_chat, make_execution, make_rule


def _flow(*, close_conversation: bool) -> dict:
    return {
        "conditions": {},
        "nodes": [
            {
                "id": "trigger",
                "type": "trigger",
                "position": {"x": 0, "y": 0},
                "data": {"trigger_type": "manual"},
            },
            {
                "id": "action",
                "type": "action",
                "position": {"x": 200, "y": 0},
                "data": {"action": {"type": "add_tag", "tag_id": 7}},
            },
            {
                "id": "end",
                "type": "end",
                "position": {"x": 400, "y": 0},
                "data": {
                    "label": "Atención terminada",
                    "close_conversation": close_conversation,
                },
            },
        ],
        "edges": [
            {"id": "1", "source": "trigger", "target": "action", "source_handle": "next"},
            {"id": "2", "source": "action", "target": "end", "source_handle": "next"},
        ],
    }


async def test_end_node_can_close_the_conversation(deps, recorder):
    execution = make_execution(flow_state={
        "definition": _flow(close_conversation=True),
        "flow_version": 0,
    })
    rule = make_rule(builder_mode="visual", flow_version=0)
    chat = make_chat(conversacion_abierta=True)

    await run_visual_execution(execution, rule, chat, deps)

    assert recorder.tags_added == [(chat["chat_id"], 7)]
    assert recorder.lead_updates == [(chat["chat_id"], {"conversacion_abierta": False})]
    assert chat["conversacion_abierta"] is False
    # El aviso por WebSocket lo emite el suscriptor de leads.


async def test_end_node_without_action_leaves_conversation_open(deps, recorder):
    execution = make_execution(flow_state={
        "definition": _flow(close_conversation=False),
        "flow_version": 0,
    })
    rule = make_rule(builder_mode="visual", flow_version=0)
    chat = make_chat(conversacion_abierta=True)

    await run_visual_execution(execution, rule, chat, deps)

    assert recorder.lead_updates == []
    assert chat["conversacion_abierta"] is True


async def test_published_flow_preserves_end_close_action(in_memory_automations):
    definition = _flow(close_conversation=True)
    definition["nodes"][1]["data"]["action"] = {
        "type": "change_stage",
        "stage": "en_diagnostico",
    }
    validated = await validate_visual_flow(
        "Cerrar al terminar",
        definition,
    )

    end = next(node for node in validated["flow_definition"]["nodes"] if node["type"] == "end")
    assert end["data"] == {
        "label": "Atención terminada",
        "close_conversation": True,
    }
