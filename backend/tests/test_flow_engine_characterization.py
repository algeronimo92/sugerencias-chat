"""El recorrido del motor por cada tipo de bloque, contra los puertos en
memoria: qué guarda en cada paso, dónde se suspende y cómo termina."""

import dataclasses
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from app.modules.automations.ports.types import AutomationActionType
from app.modules.automations.application import simulation
from app.modules.automations.application.engine import run_visual_execution
from app.modules.automations.application.flow_nodes import FLOW_NODE_HANDLERS
from app.modules.automations.domain.events import ExecutionFailed
from tests.automation_fakes import rule as stored_rule
from tests.conftest import make_chat, make_execution, make_rule


def _node(node_id, node_type, **data):
    return {"id": node_id, "type": node_type, "position": {"x": 0, "y": 0}, "data": data}


def _edge(source, target, handle="next"):
    return {"id": f"{source}-{handle}", "source": source, "target": target, "source_handle": handle}


FLOW = {
    "conditions": {},
    "nodes": [
        _node("t", "trigger", trigger_type="manual"),
        _node("c", "condition", condition_groups=[{"id": "g1"}]),
        _node("a", "action", action={"type": AutomationActionType.ADD_TAG, "tag_id": 1}),
        _node("i", "invoke_flow", flow_rule_id=9),
        _node("rr", "round_robin", outputs=[{"id": "out_1", "label": "Uno"}, {"id": "out_2", "label": "Dos"}]),
        _node("w", "wait", seconds=30),
        _node("wa", "wait_any", conditions=[
            {"id": "timer", "kind": "timer", "seconds": 60},
            {"id": "message", "kind": "message"},
        ]),
        _node("q", "question", text="¿Seguimos, {{nombre}}?", buttons=[{"id": "btn_1", "label": "Sí"}], timeout_seconds=120),
        _node("e", "end", label="Fin", close_conversation=True),
        _node("e2", "end", label="Otro"),
    ],
    "edges": [
        _edge("t", "c"),
        _edge("c", "a", "g1"),
        _edge("a", "i"),
        _edge("i", "rr"),
        _edge("rr", "w", "out_1"),
        _edge("rr", "e2", "out_2"),
        _edge("w", "wa"),
        _edge("wa", "q", "message"),
        _edge("q", "e", "timeout"),
        _edge("q", "e2", "btn_1"),
    ],
}


@pytest.fixture
def engine(executions):
    executions.rules[9] = stored_rule(
        id=9, name="Hijo", builder_mode="visual", published_flow_definition={"nodes": []},
    )

    def persisted_steps(started_at):
        steps = []
        for _execution_id, values in executions.saves:
            state = dict(values["flow_state"])
            scheduled_for = values.get("scheduled_for")
            steps.append({
                "status": str(values["status"]),
                "current": state.pop("current_node_id"),
                "path": state.pop("path"),
                "results": [
                    {key: result.get(key) for key in ("node_id", "type", "status", "branch", "seconds", "detail", "error")
                     if result.get(key) is not None}
                    for result in values["action_results"]
                ],
                "wait_in": round((scheduled_for - started_at).total_seconds()) if scheduled_for else None,
                "wait_state": sorted(key for key in state if key != "flow_version"),
                "error": values["error"],
            })
        return steps

    async def run(flow_state, deps, flow=FLOW):
        executions.saves.clear()
        executions.flow_versions[(1, 1)] = flow
        started_at = datetime.now(timezone.utc)
        execution = make_execution(flow_state={"flow_version": 1, **flow_state}, action_results=[])
        rule = make_rule(builder_mode="visual", flow_version=1)
        await run_visual_execution(execution, rule, make_chat(conversacion_abierta=True), deps)
        return persisted_steps(started_at)

    return run


async def test_engine_runs_until_the_first_timed_wait(engine, deps):
    persisted = await engine({"current_node_id": None, "path": []}, deps)

    assert [(step["status"], step["current"]) for step in persisted] == [
        ("running", "c"), ("running", "a"), ("running", "i"), ("running", "rr"), ("running", "w"), ("scheduled", "wa"),
    ]
    assert persisted[-1]["path"] == ["t", "c", "a", "i", "rr", "w"]
    assert persisted[-1]["wait_in"] == 30
    assert persisted[-1]["results"] == [
        {"node_id": "c", "type": "condition", "status": "completed", "branch": "g1", "detail": "Grupo 1 cumple: "},
        {"node_id": "a", "type": "add_tag", "status": "completed"},
        {"node_id": "i", "type": "invoke_flow", "status": "completed", "detail": "Flujo hijo iniciado: Hijo"},
        {"node_id": "rr", "type": "round_robin", "status": "completed", "branch": "out_1", "detail": "Turno: Uno"},
        {"node_id": "w", "type": "wait", "status": "scheduled", "seconds": 30},
    ]


async def test_engine_pauses_on_wait_any_first_arrival(engine, deps):
    persisted = await engine({"current_node_id": "wa", "path": ["t"]}, deps)

    assert len(persisted) == 1
    assert (persisted[0]["status"], persisted[0]["current"], persisted[0]["wait_in"]) == ("scheduled", "wa", 60)
    assert persisted[0]["wait_state"] == ["awaiting", "waiting_at_node", "waiting_since", "watching_message_id"]
    assert persisted[0]["results"] == [{"node_id": "wa", "type": "wait_any", "status": "scheduled"}]


async def test_engine_resumes_wait_any_and_asks_the_question(engine, deps):
    persisted = await engine({
        "current_node_id": "wa", "path": ["t", "wa"], "waiting_at_node": "wa", "resume_reason": "message",
    }, deps)

    assert [(step["status"], step["current"]) for step in persisted] == [("running", "q"), ("scheduled", "q")]
    assert persisted[-1]["wait_in"] == 120
    assert persisted[-1]["wait_state"] == ["awaiting", "question_buttons", "waiting_at_node", "waiting_since"]
    assert persisted[-1]["results"] == [
        {"node_id": "wa", "type": "wait_any", "status": "completed", "branch": "message"},
        {"node_id": "q", "type": "question", "status": "scheduled"},
    ]


async def test_engine_ends_when_wait_any_timer_has_no_exit(engine, deps):
    persisted = await engine({"current_node_id": "wa", "path": ["t", "wa"], "waiting_at_node": "wa"}, deps)

    assert [(step["status"], step["current"]) for step in persisted] == [("completed", None)]
    assert persisted[0]["results"] == [
        {"node_id": "wa", "type": "wait_any", "status": "completed", "branch": "timer"},
        {"type": "end", "status": "completed"},
    ]


async def test_engine_times_out_the_question_and_closes_at_the_end(engine, deps):
    persisted = await engine({"current_node_id": "q", "path": ["t", "q"], "waiting_at_node": "q"}, deps)

    assert [(step["status"], step["current"]) for step in persisted] == [("running", "e"), ("completed", None)]
    assert persisted[-1]["path"] == ["t", "q", "q", "e"]
    assert persisted[-1]["results"] == [
        {"node_id": "q", "type": "question", "status": "completed", "branch": "timeout"},
        {"node_id": "e", "type": "set_conversation_state", "status": "completed"},
        {"node_id": "e", "type": "end", "status": "completed"},
    ]


async def test_engine_records_the_failing_action_type(engine, deps, recorder):
    async def tag_gone(chat_id, tag_id, user_id):
        return False

    persisted = await engine({"current_node_id": "a", "path": ["t", "c"]}, dataclasses.replace(deps, assign_tag=tag_gone))

    assert persisted[-1]["status"] == "failed"
    assert persisted[-1]["current"] == "a"
    assert persisted[-1]["results"][-1] == {
        "node_id": "a", "type": "add_tag", "status": "failed", "error": "Lead o etiqueta no encontrado",
    }
    [failure] = recorder.of(ExecutionFailed)
    assert failure.error == "Lead o etiqueta no encontrado"


async def test_engine_fails_when_an_edge_is_missing(engine, deps):
    unmatched = {**FLOW, "nodes": [
        _node("c", "condition", condition_groups=[{
            "id": "g1", "conditions": [{"condition_type": "stage_equals", "value": "otra"}],
        }]) if node["id"] == "c" else node
        for node in FLOW["nodes"]
    ]}

    persisted = await engine({"current_node_id": "c", "path": ["t"]}, deps, flow=unmatched)

    assert persisted[-1]["status"] == "failed"
    assert persisted[-1]["results"][-1]["type"] == "flow"


@pytest.fixture
def simulator(in_memory_automations, deps, monkeypatch):
    in_memory_automations.rules.rules[1] = {
        "id": 1, "name": "Flujo", "builder_mode": "visual", "flow_definition": FLOW, "flow_version": 3,
    }
    deps.executions.rules[9] = stored_rule(id=9, name="Hijo", builder_mode="visual")
    monkeypatch.setattr(simulation, "validate_visual_flow", AsyncMock(return_value={"conditions": {}, "flow_definition": FLOW}))

    async def closed_window(chat_id):
        return {"is_open": False}

    return dataclasses.replace(
        deps,
        fetch_chat=AsyncMock(return_value=make_chat(last_message="hola", last_message_sender="cliente")),
        get_customer_service_window=closed_window,
    )


async def test_simulator_walks_every_node_type(simulator):
    result = await simulation.simulate_visual_flow(1, "lead-1", simulator)

    assert result["flow_version"] == 3
    assert [
        {key: step[key] for key in ("node_id", "type", "status", "branch", "detail", "seconds") if key in step}
        for step in result["path"]
    ] == [
        {"node_id": "t", "type": "trigger", "status": "matched"},
        {"node_id": "c", "type": "condition", "status": "evaluated", "branch": "g1", "detail": "Grupo 1 cumple: "},
        {"node_id": "a", "type": "add_tag", "status": "would_run"},
        {"node_id": "i", "type": "invoke_flow", "status": "would_run", "detail": "Iniciaría el flujo hijo: Hijo"},
        {"node_id": "rr", "type": "round_robin", "status": "evaluated", "branch": "out_1", "detail": "Le tocaría el turno a: Uno"},
        {"node_id": "w", "type": "wait", "status": "would_wait", "seconds": 30},
        {"node_id": "wa", "type": "wait_any", "status": "would_wait"},
        {"node_id": None, "type": "end", "status": "completed"},
    ]


async def test_simulator_marks_templates_that_would_fail_and_closing_ends(simulator, monkeypatch):
    flow = {
        "conditions": {},
        "nodes": [
            _node("t", "trigger", trigger_type="manual"),
            _node("a", "action", action={"type": AutomationActionType.SEND_TEMPLATE, "template_id": 1}),
            _node("q", "question", text="¿?", buttons=[{"id": "btn_1", "label": "Sí"}], timeout_seconds=60),
            _node("e", "end", label="Fin", close_conversation=True),
        ],
        "edges": [_edge("t", "a"), _edge("a", "q"), _edge("q", "e", "timeout")],
    }
    monkeypatch.setattr(simulation, "validate_visual_flow", AsyncMock(return_value={"conditions": {}, "flow_definition": flow}))

    result = await simulation.simulate_visual_flow(1, "lead-1", simulator)

    assert [(step["node_id"], step["type"], step["status"]) for step in result["path"]] == [
        ("t", "trigger", "matched"),
        ("a", "send_template", "would_fail"),
        ("q", "question", "would_wait"),
        ("e", "set_conversation_state", "would_run"),
        ("e", "end", "completed"),
    ]
    assert result["path"][2]["buttons"] == [{"id": "btn_1", "label": "Sí"}]


def test_every_flow_node_type_has_a_handler():
    from app.modules.automations.ports.types import FlowNodeType

    assert set(FLOW_NODE_HANDLERS) == set(FlowNodeType)
