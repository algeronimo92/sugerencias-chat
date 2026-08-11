"""Acciones opcionales que se ejecutan al llegar a un bloque Fin."""

import dataclasses
from types import SimpleNamespace

from services import automation_service
from services.automation_service import _run_visual_execution
from tests.conftest import make_chat, make_execution, make_rule


class _SuccessfulSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return False

    async def execute(self, _statement):
        return SimpleNamespace(rowcount=1)

    async def commit(self):
        pass


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

    await _run_visual_execution(
        execution,
        rule,
        chat,
        dataclasses.replace(deps, session_factory=lambda: _SuccessfulSession),
    )

    assert recorder.tags_added == [(chat["chat_id"], 7)]
    assert recorder.lead_updates == [(chat["chat_id"], {"conversacion_abierta": False})]
    assert chat["conversacion_abierta"] is False
    assert recorder.broadcasts[-1]["reason"] == "conversation_closed"


async def test_end_node_without_action_leaves_conversation_open(deps, recorder):
    execution = make_execution(flow_state={
        "definition": _flow(close_conversation=False),
        "flow_version": 0,
    })
    rule = make_rule(builder_mode="visual", flow_version=0)
    chat = make_chat(conversacion_abierta=True)

    await _run_visual_execution(
        execution,
        rule,
        chat,
        dataclasses.replace(deps, session_factory=lambda: _SuccessfulSession),
    )

    assert recorder.lead_updates == []
    assert chat["conversacion_abierta"] is True


async def test_published_flow_preserves_end_close_action(monkeypatch):
    definition = _flow(close_conversation=True)
    definition["nodes"][1]["data"]["action"] = {
        "type": "change_stage",
        "stage": "en_diagnostico",
    }
    monkeypatch.setattr(
        automation_service,
        "get_sessionmaker",
        lambda: lambda: _SuccessfulSession(),
    )

    validated = await automation_service.validate_visual_flow(
        "Cerrar al terminar",
        definition,
    )

    end = next(node for node in validated["flow_definition"]["nodes"] if node["type"] == "end")
    assert end["data"] == {
        "label": "Atención terminada",
        "close_conversation": True,
    }
