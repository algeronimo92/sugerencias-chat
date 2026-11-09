"""La biblioteca de plantillas que se publica en la plataforma."""

import pytest

from app.modules.ai.knowledge_service import DOCUMENT_TYPES, chunk_text
from scripts.seed_knowledge_templates import load_library, parse_template


def test_parse_template_reads_the_header_and_keeps_the_body():
    template = parse_template("---\ntitle: Ficha: HIFU 12D\ndocument_type: ficha\nservice_hint: HIFU 12D\n---\n\n## HIFU 12D\nTexto.\n")
    assert template == {
        "title": "Ficha: HIFU 12D", "document_type": "ficha", "service_hint": "HIFU 12D",
        "content": "## HIFU 12D\nTexto.", "is_active": True,
    }


@pytest.mark.parametrize("text", ["sin cabecera", "---\ntitle: X\n", "---\nautor: X\n---\nTexto"])
def test_parse_template_rejects_a_broken_header(text):
    with pytest.raises(ValueError):
        parse_template(text)


def test_the_library_is_publishable_as_is():
    templates = load_library()
    titles = [template["title"] for template in templates]

    assert len(templates) == 20 and len(set(titles)) == len(titles)
    assert sum(template["document_type"] == "ficha" for template in templates) == 16
    for template in templates:
        assert template["document_type"] in DOCUMENT_TYPES
        assert template["content"]
        # Plantilla de plataforma: ni el nombre del negocio de origen, ni la
        # navegación del vault, ni las notas internas de validación.
        for leftover in ("DermicaPro", "[[", "[VALIDAR", "[COMPLETAR", "[CONFIRMAR", "[DEFINIR"):
            assert leftover not in template["content"], (template["title"], leftover)
        # Ni los datos de la clínica de origen (dirección, medios de pago,
        # montos), ni referencias a documentos del vault que acá no existen,
        # ni nombres de autores de ventas: lo decidió el panel del 2026-11-09.
        for leftover in (
            "Trujillo", "maps.app", "Yape", "Plin", "S/ 50", "S/ 80", "S/ 160", "S/ 590", "S/ 400",
            "decisiones-agente", "funnel-estados-leads", "formatos-mensaje", "fichas-procedimientos",
            "playbook-objeciones", "mapa-dolores-soluciones", "herramienta 'precios'",
            "Hormozi", "Miner", "Voss", "Belfort", "Cardone", "Ziglar", "Sandler", "Rackham",
        ):
            assert leftover not in template["content"], (template["title"], leftover)


def test_each_ficha_is_a_self_contained_fragment():
    hifu = next(template for template in load_library() if template["title"] == "Ficha: HIFU 12D")
    chunks = chunk_text(hifu["content"])
    assert len(chunks) == 1 and chunks[0].startswith("[HIFU 12D]")
