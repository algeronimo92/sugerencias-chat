"""Ningún nodo Postgres en los workflows de n8n.

Cada uno acopla el esquema de la base al workflow. El analista lee el
contexto y aplica su resultado por la API del backend (ver
app/integrations/n8n/api.py); este test evita que vuelva un acceso directo.
"""

import json
from pathlib import Path

import pytest

WORKFLOWS = sorted((Path(__file__).resolve().parent / "fixtures" / "n8n").glob("*.json"))


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


def test_webhooks_only_serve_meta_and_the_analyst():
    """Los mensajes de Meta entran directo; de n8n solo queda el analista.

    Los endpoints que reemplazaban nodos Postgres del flujo viejo de
    recepción (lead-raw, lead-stage, lead-touch...) se borraron cuando Meta
    dejó de pasar por n8n: que no reaparezcan sin un consumidor real.
    """
    from main import app

    webhook_paths = {
        route.path for route in app.routes
        if getattr(route, "path", "").startswith("/api/webhooks/")
    }
    assert webhook_paths == {
        "/api/webhooks/meta/whatsapp",
        "/api/webhooks/analysis-context",
        "/api/webhooks/analysis-jobs/{job_id}/apply",
    }
