"""Contrato de identidad y autorizacion del copiloto RAG de n8n."""

import json
from pathlib import Path

import pytest


WORKFLOW_PATH = Path(__file__).resolve().parent / "fixtures" / "n8n" / "rag.json"


def workflow() -> dict:
    return json.loads(WORKFLOW_PATH.read_text(encoding="utf-8"))


def nodes_by_name() -> dict[str, dict]:
    return {node["name"]: node for node in workflow()["nodes"]}


def test_subworkflow_trigger_enters_copilot_contract_not_message_ingestion():
    data = workflow()
    trigger = nodes_by_name()["When Executed by Another Workflow"]
    input_names = {
        item["name"] for item in trigger["parameters"]["workflowInputs"]["values"]
    }
    assert {
        "operation", "job_id", "tenant_context_token", "context_revision",
        "chat_id", "instruction",
    } <= input_names
    assert data["connections"]["When Executed by Another Workflow"]["main"][0][0]["node"] == (
        "normalizar solicitud RAG"
    )
    assert "Resolver identidad WhatsApp" not in nodes_by_name()
    assert "Webhook4" not in nodes_by_name()


def test_copilot_reads_crm_only_with_job_and_tenant_context():
    by_name = nodes_by_name()
    node = by_name["cargar contexto RAG"]
    assert node["type"] == "n8n-nodes-base.httpRequest"
    parameters = node["parameters"]
    assert parameters["url"].endswith("/api/webhooks/rag-context' }}")
    headers = {
        item["name"]: item["value"]
        for item in parameters["headerParameters"]["parameters"]
    }
    assert "tenant_context_token" in headers["X-Tenant-Context"]
    assert "job_id" in headers["X-Job-Id"]
    query = {
        item["name"]: item["value"]
        for item in parameters["queryParameters"]["parameters"]
    }
    assert query == {
        "chat_id": "={{ $('normalizar solicitud RAG').item.json.chat_id }}",
        "limit": "500",
    }


def test_workflow_does_not_accept_raw_remote_jid_as_chat_identity():
    text = WORKFLOW_PATH.read_text(encoding="utf-8")
    assert "remoteJid" not in text
    assert "remote_jid" not in text
    assert "body.instance" not in text
    assert "instance:" not in text
