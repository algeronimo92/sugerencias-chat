"""Tests del bloque Round robin: normalización de sus salidas, la topología
que exige conectarlas todas, y el motor repartiendo una ejecución por turno.
"""

import dataclasses
from types import SimpleNamespace

import pytest

from domain_types import AutomationExecutionStatus
from services.automation_rules import validate_graph_topology
from services.automation_service import (
    _normalize_round_robin,
    _run_visual_execution,
)
from tests.conftest import make_chat, make_execution, make_rule


def round_robin_flow(outputs=3):
    """Disparador → round robin con N salidas → un Fin por salida."""
    ids = [f"out_{index}" for index in range(1, outputs + 1)]
    return {
        "conditions": {},
        "nodes": [
            {"id": "t", "type": "trigger", "position": {"x": 0, "y": 0}, "data": {"trigger_type": "manual"}},
            {"id": "rr", "type": "round_robin", "position": {"x": 0, "y": 0}, "data": {
                "outputs": [{"id": output_id, "label": f"Vendedor {index}"} for index, output_id in enumerate(ids, start=1)],
            }},
            *[{"id": f"e_{output_id}", "type": "end", "position": {"x": 0, "y": 0}, "data": {"label": output_id}} for output_id in ids],
        ],
        "edges": [
            {"id": "1", "source": "t", "target": "rr", "source_handle": "next"},
            *[
                {"id": f"edge_{output_id}", "source": "rr", "target": f"e_{output_id}", "source_handle": output_id}
                for output_id in ids
            ],
        ],
    }


def counting_session():
    """FakeSession que emula el contador persistente: `scalar` devuelve el
    turno ya incrementado, igual que el INSERT ... ON CONFLICT DO UPDATE
    ... RETURNING de _next_round_robin_output. `calls` acumula lo que se
    persistió de la ejecución."""
    calls: list[dict] = []
    state = {"counter": 0}

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def scalar(self, stmt):
            state["counter"] += 1
            return state["counter"]

        async def execute(self, stmt):
            calls.append(stmt.compile().params)
            return SimpleNamespace(rowcount=1)

        async def commit(self):
            pass

    return FakeSession, calls, state


class TestNormalizeRoundRobin:
    def test_assigns_positional_ids(self):
        result = _normalize_round_robin(
            {"outputs": [{"id": "cualquiera", "label": "Ana"}, {"id": "otro", "label": "Luis"}]}, 1,
        )
        assert result == {"outputs": [
            {"id": "out_1", "label": "Ana"},
            {"id": "out_2", "label": "Luis"},
        ]}

    def test_fills_in_missing_labels(self):
        result = _normalize_round_robin({"outputs": [{"label": ""}, {"label": "  "}]}, 1)
        assert [output["label"] for output in result["outputs"]] == ["Salida 1", "Salida 2"]

    def test_accepts_the_maximum(self):
        result = _normalize_round_robin({"outputs": [{"label": str(n)} for n in range(10)]}, 1)
        assert len(result["outputs"]) == 10

    @pytest.mark.parametrize("count", [0, 1, 11])
    def test_rejects_output_counts_out_of_range(self, count):
        with pytest.raises(ValueError, match="entre 2 y 10 salidas"):
            _normalize_round_robin({"outputs": [{"label": str(n)} for n in range(count)]}, 1)

    def test_rejects_missing_outputs(self):
        with pytest.raises(ValueError, match="entre 2 y 10 salidas"):
            _normalize_round_robin({}, 1)


class TestRoundRobinTopology:
    def test_accepts_every_output_connected(self):
        flow = round_robin_flow(3)
        validate_graph_topology(flow["nodes"], flow["edges"], "t")

    def test_rejects_an_unconnected_output(self):
        flow = round_robin_flow(3)
        # Sin la conexión de out_3 su bloque Fin queda huérfano: el mensaje que
        # importa es el del reparto, que es el error que el usuario puede
        # arreglar.
        flow["edges"] = [edge for edge in flow["edges"] if edge["source_handle"] != "out_3"]
        flow["nodes"] = [node for node in flow["nodes"] if node["id"] != "e_out_3"]
        with pytest.raises(ValueError, match="salida del round robin"):
            validate_graph_topology(flow["nodes"], flow["edges"], "t")

    def test_rejects_two_connections_on_the_same_output(self):
        flow = round_robin_flow(2)
        flow["edges"].append(
            {"id": "extra", "source": "rr", "target": "e_out_2", "source_handle": "out_1"}
        )
        with pytest.raises(ValueError, match="salida del round robin"):
            validate_graph_topology(flow["nodes"], flow["edges"], "t")


class TestRunVisualExecutionRoundRobin:
    async def test_rotates_through_every_output_and_starts_over(self, deps):
        """Cuatro ejecuciones sobre un bloque de tres salidas: 1, 2, 3 y de
        nuevo la 1."""
        FakeSession, calls, _ = counting_session()
        session_deps = dataclasses.replace(deps, session_factory=lambda: FakeSession)
        rule = make_rule(builder_mode="visual", flow_version=0)
        branches = []

        for attempt in range(4):
            execution = make_execution(id=100 + attempt, flow_state={
                "definition": round_robin_flow(3), "flow_version": 0,
                "current_node_id": "rr", "path": ["t"],
            })
            await _run_visual_execution(execution, rule, make_chat(), session_deps)
            final = calls[-1]
            assert final["status"] == AutomationExecutionStatus.COMPLETED
            branches.append(
                next(r for r in final["action_results"] if r["type"] == "round_robin")["branch"]
            )

        assert branches == ["out_1", "out_2", "out_3", "out_1"]

    async def test_follows_the_edge_of_the_output_it_got(self, deps):
        FakeSession, calls, _ = counting_session()
        execution = make_execution(flow_state={
            "definition": round_robin_flow(2), "flow_version": 0,
            "current_node_id": "rr", "path": ["t"],
        })
        rule = make_rule(builder_mode="visual", flow_version=0)

        await _run_visual_execution(
            execution, rule, make_chat(),
            dataclasses.replace(deps, session_factory=lambda: FakeSession),
        )

        final = calls[-1]
        assert final["flow_state"]["path"] == ["t", "rr", "e_out_1"]
        assert final["flow_state"]["current_node_id"] is None
        result = next(r for r in final["action_results"] if r["type"] == "round_robin")
        assert result["detail"] == "Turno: Vendedor 1"
