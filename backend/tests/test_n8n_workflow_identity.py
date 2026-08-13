"""Contrato entre el workflow rag de n8n y el resolvedor LID del backend."""

import json
from pathlib import Path

import pytest


WORKFLOW_PATH = Path(__file__).resolve().parents[2] / "rag.json"
pytestmark = pytest.mark.skipif(
    not WORKFLOW_PATH.exists(),
    reason="rag.json es una exportación local sensible y no se versiona",
)
RESOLVER = "Resolver identidad WhatsApp"
MERGE = "Merge identidad WhatsApp"
CANONICAL_CHAT_ID = "={{ $('Resolver identidad WhatsApp').first().json.chat_id }}"
CONTENT_NODES = {
    "sticker content",
    "document content",
    "location content",
    "contact content",
    "poll content",
    "order content",
    "unsupported content",
    "audio content",
    "image content",
    "text content",
    "video content",
    "template content1",
    "buttons content2",
    "buttons content3",
}


def _workflow() -> dict:
    return json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))


def _nodes_by_name(workflow: dict) -> dict[str, dict]:
    return {node["name"]: node for node in workflow["nodes"]}


def _chat_id_value(node: dict) -> str | None:
    assignments = node.get("parameters", {}).get("assignments", {}).get("assignments", [])
    return next((item["value"] for item in assignments if item.get("name") == "chat_id"), None)


def test_workflow_json_and_graph_are_valid():
    workflow = _workflow()
    nodes = _nodes_by_name(workflow)

    assert len(nodes) == len(workflow["nodes"]), "Hay nombres de nodos duplicados"
    for source in workflow["connections"].values():
        for branches in source.values():
            for branch in branches:
                for edge in branch:
                    assert edge["node"] in nodes


def test_inbound_messages_are_resolved_before_content_processing():
    workflow = _workflow()
    nodes = _nodes_by_name(workflow)

    resolver = nodes[RESOLVER]
    assert resolver["type"] == "n8n-nodes-base.httpRequest"
    assert resolver["parameters"]["url"].endswith(
        "/api/webhooks/resolve-whatsapp-identity"
    )
    assert resolver["parameters"]["jsonBody"] == (
        "={{ JSON.stringify($json.body || $json) }}"
    )

    router_message_branch = workflow["connections"]["router de evento1"]["main"][1]
    assert {edge["node"] for edge in router_message_branch} == {RESOLVER, MERGE}
    assert workflow["connections"][RESOLVER]["main"][0][0] == {
        "node": MERGE,
        "type": "main",
        "index": 1,
    }
    assert workflow["connections"][MERGE]["main"][0][0]["node"] == "set files"


def test_every_evolution_content_branch_uses_canonical_chat_id():
    nodes = _nodes_by_name(_workflow())

    for name in CONTENT_NODES:
        assert _chat_id_value(nodes[name]) == CANONICAL_CHAT_ID, name
        assignment = next(
            item
            for item in nodes[name]["parameters"]["assignments"]["assignments"]
            if item.get("name") == "chat_id"
        )
        assert assignment["type"] == "string", name

    reaction_body = nodes["reaction webhook1"]["parameters"]["bodyParameters"]["parameters"]
    reaction_chat_id = next(item["value"] for item in reaction_body if item["name"] == "chat_id")
    assert reaction_chat_id == CANONICAL_CHAT_ID


def test_no_expression_uses_raw_remote_jid_as_chat_id():
    workflow_text = WORKFLOW_PATH.read_text(encoding="utf-8")

    assert "data.key.remoteJid }}" not in workflow_text


def test_postgres_lead_nodes_use_internal_id():
    nodes = _nodes_by_name(_workflow())

    for name in {"get lead1", "get lead4", "try to get lead"}:
        where = nodes[name]["parameters"]["where"]["values"]
        assert where[0]["column"] == "id", name

    for name in {"update lead", "update lead4"}:
        columns = nodes[name]["parameters"]["columns"]
        assert columns["matchingColumns"] == ["id"], name
        assert "remote_jid" not in columns["value"], name
        id_schema = next(item for item in columns["schema"] if item["id"] == "id")
        assert id_schema["type"] == "string", name

    create_columns = nodes["create lead"]["parameters"]["columns"]
    create_values = create_columns["value"]
    assert "id" in create_values
    assert "remote_jid" not in create_values
    create_id_schema = next(item for item in create_columns["schema"] if item["id"] == "id")
    assert create_id_schema["type"] == "string"

    stage_body = nodes["actualizar estado lead"]["parameters"]["bodyParameters"]["parameters"]
    stage_chat_id = next(item["value"] for item in stage_body if item["name"] == "chat_id")
    assert stage_chat_id == "={{ $json.id }}"


def test_analyst_preserves_contact_identity_and_rejects_own_account_names():
    nodes = _nodes_by_name(_workflow())
    values = nodes["update lead"]["parameters"]["columns"]["value"]

    assert "Edit Fields1" in values["nombre"]
    assert "dermicapro" in values["nombre"].lower()
    assert "você" in values["nombre"].lower()
    assert "Edit Fields1" in values["telefono"]
