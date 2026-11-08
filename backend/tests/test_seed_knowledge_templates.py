"""El sembrador de plantillas reproduce los cortes del índice que tenía n8n."""

from pathlib import Path

from scripts.seed_knowledge_templates import build_templates, clean


def _write(root: Path, relative: str, text: str) -> None:
    path = root / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def test_clean_drops_vault_links_editorial_marks_and_the_source_business_name():
    text = clean(
        "Ver [[playbook-objeciones]] y [[operacion|datos operativos]].\n\n---\n\n"
        "Anestesia tópica. **[VALIDAR protocolo de DermicaPro]**\n"
        "Bienvenida a *DermicaPro* 😊"
    )
    assert text == (
        "Ver playbook-objeciones y datos operativos.\n\n"
        "Anestesia tópica.\nBienvenida a *[NEGOCIO]* 😊"
    )


def test_one_template_per_procedure_and_one_per_whole_document(tmp_path: Path):
    _write(tmp_path, "negocio/fichas-procedimientos.md", (
        "# Negocio · Fichas\n\n> BORRADOR para validar.\n\n---\n\n"
        "## Hollywood Peel (protocolo de 9 pasos)\n**En qué consiste:** carbón y láser.\n\n"
        "## Borrado de Cejas · Borrado de Tatuajes (picoláser)\n**En qué consiste:** picoláser.\n\n"
        "## Uso en ventas (cruce con la base de expertos)\nNotas internas.\n"
    ))
    _write(tmp_path, "negocio/mapa-dolores-soluciones.md", '# Mapa (DermicaPro)\n\n## ROSTRO\n\n### "Tengo manchas"\n- Tranexámico.\n')
    _write(tmp_path, "guias/playbook-objeciones.md", '# Playbook\n\n### "Está caro"\nSubir valor.\n')
    _write(tmp_path, "negocio/guiones-whatsapp.md", "# Guiones DermicaPro\n\n## 1 · Primer contacto\n> Hola 😊\n")

    templates = {template["title"]: template for template in build_templates(tmp_path)}

    assert set(templates) == {
        "Ficha: Hollywood Peel",
        "Ficha: Borrado de Cejas · Borrado de Tatuajes",
        "Mapa dolor → solución",
        "Playbook de objeciones",
        "Guiones de WhatsApp por etapa del funnel",
    }
    peel = templates["Ficha: Hollywood Peel"]
    assert (peel["document_type"], peel["service_hint"]) == ("ficha", "Hollywood Peel")
    # El encabezado viaja con la ficha para que su fragmento se entienda solo.
    assert peel["content"].startswith("## Hollywood Peel (protocolo de 9 pasos)")
    # El nombre de la ficha no coincide con el catálogo: la pista sí.
    assert templates["Ficha: Borrado de Cejas · Borrado de Tatuajes"]["service_hint"] == "Borrado de Tatuajes"
    # El título del archivo (con el nombre del negocio de origen) no entra.
    assert templates["Mapa dolor → solución"]["content"].startswith("## ROSTRO")
    assert templates["Mapa dolor → solución"]["document_type"] == "faq"
