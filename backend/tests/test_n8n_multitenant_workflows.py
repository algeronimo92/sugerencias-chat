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


def test_meta_verifies_signature_and_persists_before_ack():
    """La firma y el verify token ya no viven en $env (el plan de n8n no
    permite crearlas): el Code node reenvia el crudo al backend, que compara
    contra la configuracion de ``app_settings`` (ver services/meta_webhook_auth.py).

    "Config (POST)" queda en linea antes de la verificacion, asi que un nodo
    normalizador aparte reconstruye el cuerpo crudo leyendo directo del
    webhook (el body de n8n puede llegar como string, Buffer o binario segun
    la version) en vez de depender de que el $json de la verificacion sea el
    del webhook original."""
    workflow = load(META_PATH)
    by_name = nodes(workflow)
    webhook = by_name["Meta eventos (POST)"]
    verifier = by_name["verificar firma Meta POST"]
    raw_body_prep = by_name["preparar cuerpo crudo Meta"]
    challenge_check = by_name["verificar token"]

    assert webhook["parameters"]["options"]["rawBody"] is True
    assert targets(workflow, "Meta eventos (POST)") == ["Config (POST)"]
    assert targets(workflow, "Config (POST)") == ["preparar cuerpo crudo Meta"]
    assert targets(workflow, "preparar cuerpo crudo Meta") == ["verificar firma Meta POST"]
    assert targets(workflow, "verificar firma Meta POST") == ["es cambio de plantilla?"]
    assert targets(workflow, "es cambio de plantilla?") == [
        "normalizar cambio plantilla", "normalizar eventos Meta",
    ]

    assert "Meta eventos (POST)" in raw_body_prep["parameters"]["jsCode"]
    assert "binary" in raw_body_prep["parameters"]["jsCode"]
    assert "raw_body" in raw_body_prep["parameters"]["jsCode"]

    assert verifier["type"] == "n8n-nodes-base.httpRequest"
    assert verifier["parameters"]["url"].endswith("/api/webhooks/meta/verify-signature' }}")
    assert verifier["parameters"]["body"] == "={{ $json.raw_body }}"
    header_values = {h["name"]: h["value"] for h in verifier["parameters"]["headerParameters"]["parameters"]}
    assert "x-hub-signature-256" in header_values["x-hub-signature-256"]

    assert challenge_check["type"] == "n8n-nodes-base.httpRequest"
    assert challenge_check["parameters"]["url"].endswith("/api/webhooks/meta/verify-challenge' }}")
    assert "hub.verify_token" in challenge_check["parameters"]["jsonBody"]
    # No debe leer $json a secas: en la topologia en linea, Config corre
    # antes y $json ahi es la salida de Config, no el query del webhook.
    assert "$('Meta verificacion (GET)')" in challenge_check["parameters"]["jsonBody"]

    assert has_path(workflow, "normalizar eventos Meta", "registrar evento Meta en inbox")
    assert has_path(workflow, "registrar evento Meta en inbox", "responder 200 a Meta")
    assert not has_path(workflow, "responder 200 a Meta", "registrar evento Meta en inbox")


def test_meta_has_durable_replay_and_completes_only_terminal_branches():
    workflow = load(META_PATH)
    by_name = nodes(workflow)

    assert has_path(workflow, "reintentar inbox Meta", "evento Meta activo")
    assert has_path(workflow, "evento Meta activo", "tipo de evento")
    claim = by_name["reclamar eventos Meta pendientes"]["parameters"]
    assert claim["queryParameters"]["parameters"] == [{"name": "limit", "value": "100"}]
    assert "jsonBody" not in claim
    complete = by_name["marcar evento Meta completo"]
    assert "/meta-events/inbox/" in complete["parameters"]["url"]
    assert complete["parameters"]["jsonBody"] == "={{ JSON.stringify({ status: 'processed' }) }}"
    for terminal in (
        "avisar al backend", "actualizar estado", "guardar reaccion",
        "sincronizar plantilla completa",
    ):
        assert targets(workflow, terminal) == ["marcar evento Meta completo"]
    assert targets(workflow, "mensaje nuevo?")[1] == "avisar al backend"


def test_meta_callbacks_keep_connection_and_event_context_without_ai():
    workflow = load(META_PATH)
    by_name = nodes(workflow)
    workflow_text = META_PATH.read_text(encoding="utf-8")

    assert "phone_number_id" in by_name["normalizar eventos Meta"]["parameters"]["jsCode"]
    assert "contacts[0]" not in workflow_text
    assert "@null" not in workflow_text
    assert "dermicapro-business" not in workflow_text
    assert not any("langchain" in node["type"] for node in workflow["nodes"])

    callback_names = {
        "resolver identidad", "asegurar lead", "buscar mensaje existente",
        "importar adjunto de Meta", "guardar mensaje", "avisar al backend",
        "actualizar estado", "resolver identidad (reaccion)", "guardar reaccion",
        "marcar evento Meta completo",
    }
    for name in callback_names:
        assert {"X-Meta-Phone-Number-Id", "X-Meta-Event-Id"} <= header_names(by_name[name]), name

    template_callback = by_name["sincronizar plantilla completa"]
    assert {"X-Meta-Waba-Id", "X-Meta-Event-Id"} <= header_names(template_callback)
    assert template_callback["parameters"]["method"] == "PUT"
    assert "/api/webhooks/templates/" in template_callback["parameters"]["url"]
    assert "sendBody" not in template_callback["parameters"]


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js no esta disponible")
def test_meta_template_change_normalizer_uses_waba_routing():
    payload = [{
        "body": {
            "object": "whatsapp_business_account",
            "entry": [{
                "id": "WABA_1",
                "time": 1770000000,
                "changes": [{
                    "field": "template_category_update",
                    "value": {
                        "message_template_id": "META_TEMPLATE_1",
                        "message_template_name": "recordatorio_cita",
                        "message_template_language": "es",
                        "previous_category": "UTILITY",
                        "new_category": "MARKETING",
                    },
                }],
            }],
        },
    }]
    harness = r"""
const fs = require('fs');
const workflow = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const code = workflow.nodes.find((node) => node.name === 'normalizar cambio plantilla').parameters.jsCode;
const values = JSON.parse(fs.readFileSync(0, 'utf8'));
const items = values.map((json) => ({ json }));
const byNodeName = {
  'Meta eventos (POST)': { all: () => items },
  'Config (POST)': { item: { json: { backend_url: 'https://backend.test/' } } },
};
const $ = (name) => byNodeName[name];
const execute = new Function('$', code);
Promise.resolve(execute($))
  .then((result) => process.stdout.write(JSON.stringify(result.map((item) => item.json))))
  .catch((error) => { process.stderr.write(error.stack); process.exit(1); });
"""
    completed = subprocess.run(
        [shutil.which("node"), "-e", harness, str(META_PATH)],
        input=json.dumps(payload), text=True, capture_output=True, check=True,
    )
    result = json.loads(completed.stdout)

    assert result == [{
        "_kind": "template_sync",
        "provider": "meta_cloud_api",
        "phone_number_id": None,
        "waba_id": "WABA_1",
        "event_key": "WABA_1:template_sync:template_category_update:META_TEMPLATE_1:1770000000",
        "meta_template_id": "META_TEMPLATE_1",
        "template_name": "recordatorio_cita",
        "template_language": "es",
        "change_field": "template_category_update",
        "payload": {
            "field": "template_category_update",
            "value": payload[0]["body"]["entry"][0]["changes"][0]["value"],
        },
        "backend_url": "https://backend.test",
    }]


@pytest.mark.skipif(shutil.which("node") is None, reason="Node.js no esta disponible")
def test_meta_normalizer_handles_missing_and_mixed_profiles_per_phone_number():
    payload = [{
        "body": {
            "entry": [{
                "changes": [
                    {
                        "value": {
                            "metadata": {"phone_number_id": "PHONE_A"},
                            "contacts": [
                                {"wa_id": "222", "profile": {"name": "Dos"}},
                                {"wa_id": "333", "profile": {"name": "Tres", "username": "tres"}},
                            ],
                            "messages": [
                                {"id": "m1", "from": "111", "timestamp": "1", "type": "text", "text": {"body": "uno"}},
                                {"id": "m2", "from": "222", "timestamp": "2", "type": "text", "text": {"body": "dos"}},
                                {"id": "m3", "from": "333", "timestamp": "3", "type": "text", "text": {"body": "tres"}},
                                {"id": "m4", "from": "333", "timestamp": "4", "type": "button", "button": {"text": "OpcionA", "payload": "OpcionA"}},
                            ],
                        }
                    },
                    {
                        "value": {
                            "metadata": {"phone_number_id": "PHONE_B"},
                            "statuses": [{"id": "s1", "recipient_id": "444", "status": "delivered", "timestamp": "4"}],
                        }
                    },
                ]
            }]
        }
    }]
    harness = r"""
const fs = require('fs');
const workflow = JSON.parse(fs.readFileSync(process.argv[1], 'utf8'));
const code = workflow.nodes.find((node) => node.name === 'normalizar eventos Meta').parameters.jsCode;
const values = JSON.parse(fs.readFileSync(0, 'utf8'));
const items = values.map((json) => ({ json }));
const byNodeName = {
  'Meta eventos (POST)': { all: () => items },
  'Config (POST)': { item: { json: { backend_url: 'https://backend.test' } } },
};
const $ = (name) => byNodeName[name];
const execute = new Function('$', code);
Promise.resolve(execute($))
  .then((result) => process.stdout.write(JSON.stringify(result.map((item) => item.json))))
  .catch((error) => { process.stderr.write(error.stack); process.exit(1); });
"""
    completed = subprocess.run(
        [shutil.which("node"), "-e", harness, str(META_PATH)],
        input=json.dumps(payload), text=True, capture_output=True, check=True,
    )
    result = json.loads(completed.stdout)

    assert [item["phone_number_id"] for item in result] == ["PHONE_A"] * 4 + ["PHONE_B"]
    assert result[0]["push_name"] is None and result[0]["username"] is None
    assert result[1]["push_name"] == "Dos" and result[1]["username"] is None
    assert result[2]["push_name"] == "Tres" and result[2]["username"] == "@tres"
    assert result[3]["message_type"] == "button"
    assert result[3]["content"] == "OpcionA"
    assert result[4]["event_key"] == "PHONE_B:status:s1"


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
