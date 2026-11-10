"""Las rutas literales de /api/ai/knowledge no pueden quedar tapadas por
``/knowledge/{document_id}``: con el orden invertido, ``GET /knowledge/templates``
respondía 422 (``templates`` no es un UUID) y el diálogo de plantillas quedaba
cargando para siempre. Los tests del frontend no lo veían porque mockean HTTP.
"""

import pytest
from starlette.routing import Match

from app.modules.ai import assistant_api


def _first_match(method: str, path: str) -> str:
    scope = {"type": "http", "method": method, "path": path}
    for route in assistant_api.router.routes:
        match, _ = route.matches(scope)
        if match is Match.FULL:
            return route.endpoint.__name__
    raise AssertionError(f"ninguna ruta atiende {method} {path}")


@pytest.mark.parametrize(
    ("method", "path", "endpoint"),
    [
        ("GET", "/api/ai/knowledge/templates", "read_knowledge_templates"),
        ("POST", "/api/ai/knowledge/templates/3/import", "import_knowledge_template"),
        ("POST", "/api/ai/knowledge/import-pdf", "import_knowledge_pdf"),
        ("GET", "/api/ai/knowledge/0b9f6c1e-8d2a-4c4b-9a43-1f1d2e3c4b5a", "read_knowledge_document"),
    ],
)
def test_literal_knowledge_routes_win_over_document_id(method: str, path: str, endpoint: str) -> None:
    assert _first_match(method, path) == endpoint
