"""Ningún nodo Postgres nuevo en los workflows de n8n.

Cada uno acopla el esquema de la base al workflow. Los que quedan ya tienen
su endpoint equivalente (ver docs/n8n-sin-acceso-a-la-base.md); este test
evita que aparezcan más mientras se completa la migración.
"""

import json
from pathlib import Path

import pytest

from main import app

WORKFLOWS = sorted((Path(__file__).resolve().parent / "fixtures" / "n8n").glob("*.json"))

# Nodo Postgres -> endpoint que lo reemplaza.
REPLACEMENTS = {
    "create lead": "/api/webhooks/ensure-lead",
    "guardar mensajes en posgress": "/api/webhooks/save-inbound-message",
    "update lead": "/api/webhooks/lead-analysis",
    "update lead4": "/api/webhooks/lead-inbound-activity",
    "get lead": "/api/webhooks/lead-raw",
    "get lead4": "/api/webhooks/lead-raw",
    "try to get lead": "/api/webhooks/lead-raw",
    "get messages1": "/api/webhooks/lead-messages-raw",
    "get messages2": "/api/webhooks/lead-messages-raw",
    "buscar mensaje existente1": "/api/webhooks/message-by-wa-id-raw",
    "ultimo mensaje1": "/api/webhooks/last-message-raw",
}


def _postgres_nodes(path: Path) -> set[str]:
    workflow = json.loads(path.read_text(encoding="utf-8"))
    return {
        node["name"] for node in workflow.get("nodes", [])
        if "postgres" in str(node.get("type", "")).lower()
    }


@pytest.mark.skipif(not WORKFLOWS, reason="los workflows no están en este checkout")
@pytest.mark.parametrize("workflow", WORKFLOWS, ids=lambda path: path.name)
def test_workflows_do_not_access_postgres_directly(workflow: Path):
    assert _postgres_nodes(workflow) == set()


def test_the_replacement_endpoints_exist():
    routes = {route.path for route in app.routes}

    assert set(REPLACEMENTS.values()) <= routes
