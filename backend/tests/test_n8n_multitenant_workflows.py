import json
import shutil
import subprocess
from pathlib import Path

import pytest


FIXTURE_ROOT = Path(__file__).resolve().parent / "fixtures" / "n8n"
RAG_PATH = FIXTURE_ROOT / "rag.json"
ANALYST_PATH = FIXTURE_ROOT / "analista.json"
META_PATH = FIXTURE_ROOT / "meta-cloud-api.json"
CONFIG_PATH = FIXTURE_ROOT / "config.json"
EXPORTS = (RAG_PATH, ANALYST_PATH, META_PATH, CONFIG_PATH)


def load(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def nodes(workflow: dict) -> dict[str, dict]:
    return {node["name"]: node for node in workflow["nodes"]}


def targets(workflow: dict, source: str, kind: str = "main") -> list[str]:
    groups = workflow.get("connections", {}).get(source, {}).get(kind, [])
    return [edge["node"] for branch in groups for edge in branch]


def has_path(workflow: dict, source: str, target: str) -> bool:
    pending = [source]
    visited: set[str] = set()
    while pending:
        current = pending.pop()
        if current == target:
            return True
        if current in visited:
            continue
        visited.add(current)
        pending.extend(targets(workflow, current))
    return False


def header_names(node: dict) -> set[str]:
    values = node.get("parameters", {}).get("headerParameters", {}).get("parameters", [])
    return {header.get("name") for header in values}


def test_exports_are_inactive_sanitized_and_have_valid_graphs():
    for path in EXPORTS:
        workflow = load(path)
        by_name = nodes(workflow)
        assert workflow["active"] is False
        assert "pinData" not in workflow
        assert all("credentials" not in node for node in workflow["nodes"])
        for node in workflow["nodes"]:
            if node["type"] == "n8n-nodes-base.code":
                assert "\ufffd" not in node["parameters"]["jsCode"], (path.name, node["name"])
        assert len(by_name) == len(workflow["nodes"]), path.name
        for source, groups in workflow["connections"].items():
            assert source in by_name, (path.name, source)
            for branches in groups.values():
                for branch in branches:
                    for edge in branch:
                        assert edge["node"] in by_name, (path.name, edge["node"])


def test_meta_workflow_is_only_a_relay_to_the_backend():
    """Si n8n queda delante de Meta, solo transporta: reenvía el challenge, el
    cuerpo crudo y la firma al endpoint directo y responde lo que respondió
    el backend. No normaliza, no arma identidades ni tipos."""
    workflow = load(META_PATH)
    by_name = nodes(workflow)
    code_nodes = [node for node in workflow["nodes"] if node["type"] == "n8n-nodes-base.code"]
    assert [node["name"] for node in code_nodes] == ["preparar cuerpo crudo Meta"]
    raw_code = code_nodes[0]["parameters"]["jsCode"]
    assert "raw_body: raw" in raw_code and "JSON.parse" not in raw_code

    forward_post = by_name["reenviar evento al backend"]
    assert forward_post["parameters"]["url"].endswith("'/api/webhooks/meta/whatsapp' }}")
    assert forward_post["parameters"]["body"] == "={{ $json.raw_body }}"
    assert forward_post["parameters"]["contentType"] == "raw"
    assert header_names(forward_post) == {"x-hub-signature-256"}
    assert has_path(workflow, "Meta eventos (POST)", "reenviar evento al backend")
    assert targets(workflow, "reenviar evento al backend") == ["responder a Meta"]
    assert by_name["responder a Meta"]["parameters"]["options"]["responseCode"] == "={{ $json.statusCode }}"

    forward_get = by_name["reenviar verificacion al backend"]
    assert forward_get["parameters"]["method"] == "GET"
    assert forward_get["parameters"]["url"].endswith("'/api/webhooks/meta/whatsapp' }}")
    assert targets(workflow, "reenviar verificacion al backend") == ["responder verificacion a Meta"]

    text = META_PATH.read_text(encoding="utf-8")
    for removed in ("normalizar", "s.whatsapp.net", "@lid", "resolve-whatsapp-identity", "meta-events/inbox"):
        assert removed not in text


def test_rag_is_only_an_authorized_on_demand_copilot():
    workflow = load(RAG_PATH)
    by_name = nodes(workflow)
    workflow_text = RAG_PATH.read_text(encoding="utf-8")

    assert has_path(workflow, "When Executed by Another Workflow", "Agente Copiloto Ventas1")
    assert has_path(workflow, "Webhook1", "Agente Copiloto Ventas1")
    assert not any("supabase" in node["type"].lower() for node in workflow["nodes"])
    assert "Call analista" not in by_name
    assert "Evolution" not in workflow_text
    assert "dermicapro-business" not in workflow_text
    assert by_name["RAG1"]["type"] == "n8n-nodes-base.httpRequestTool"
    assert by_name["RAG1"]["parameters"]["url"].endswith("/api/webhooks/rag-search' }}")
    assert by_name["precios1"]["parameters"]["url"].endswith("/api/webhooks/catalog' }}")
    assert by_name["cargar contexto RAG"]["parameters"]["url"].endswith(
        "/api/webhooks/rag-context' }}"
    )
    for name in ("RAG1", "precios1", "cargar contexto RAG"):
        assert {"X-Tenant-Context", "X-Job-Id"} <= header_names(by_name[name]), name
    # El workflow es uno solo para todos los negocios: lo que sabe de cada uno
    # llega en el contexto del job, no escrito en el prompt.
    prompt = by_name["Agente Copiloto Ventas1"]["parameters"]["text"]
    assert "$json.tenant_config" in prompt
    assert "$json.recursos" in prompt
    assert "tenant_config" in by_name["preparar contexto RAG"]["parameters"]["jsCode"]


def test_analyst_is_sql_free_on_demand_and_revision_guarded():
    workflow = load(ANALYST_PATH)
    by_name = nodes(workflow)
    workflow_text = ANALYST_PATH.read_text(encoding="utf-8")

    assert not any("postgres" in node["type"].lower() for node in workflow["nodes"])
    assert "conversacion_version" not in workflow_text
    assert "automatizacion_pausada" not in workflow_text
    assert has_path(workflow, "Datos del mensaje", "agente analista1")
    assert has_path(workflow, "Webhook analista a demanda", "agente analista1")
    # El analista solo corre a pedido del vendedor: no hay mensajes que
    # esperar, y un Wait sin unidad explícita espera horas (default de n8n).
    assert not any(node["type"] == "n8n-nodes-base.wait" for node in workflow["nodes"])
    assert has_path(workflow, "validar solicitud analista", "cargar contexto autorizado")

    trigger_inputs = {
        value["name"]
        for value in by_name["Datos del mensaje"]["parameters"]["workflowInputs"]["values"]
    }
    assert {"operation", "job_id", "tenant_context_token", "expected_revision", "chat_id"} <= trigger_inputs
    context = by_name["cargar contexto autorizado"]
    apply = by_name["aplicar analisis vigente"]
    assert context["parameters"]["url"].endswith("/api/webhooks/analysis-context' }}")
    assert "/api/webhooks/analysis-jobs/" in apply["parameters"]["url"]
    assert "context_revision" in apply["parameters"]["jsonBody"]
    assert {"X-Tenant-Context", "X-Job-Id"} <= header_names(context)
    assert {"X-Tenant-Context", "X-Job-Id"} <= header_names(apply)


def test_analyst_uses_the_business_stages_not_a_fixed_list():
    """Cada negocio configura sus etapas: el workflow las recibe en el
    contexto (analysis-context -> stages) y valida contra ellas."""
    workflow = load(ANALYST_PATH)
    by_name = nodes(workflow)

    schema = json.loads(by_name["Structured Output Parser4"]["parameters"]["inputSchema"])
    assert "enum" not in schema["properties"]["estado"]
    assert "context.stages" in by_name["preparar contexto analista"]["parameters"]["jsCode"]
    agent = by_name["agente analista1"]["parameters"]
    assert "etapas" in agent["text"]
    assert "en_nutricion" not in agent["options"]["systemMessage"]
    cleanup = by_name["Vaciar a null"]["parameters"]["jsCode"]
    assert "'en_nutricion'" not in cleanup
    assert "preparar contexto analista" in cleanup
    assert "kind === 'lost'" in cleanup
