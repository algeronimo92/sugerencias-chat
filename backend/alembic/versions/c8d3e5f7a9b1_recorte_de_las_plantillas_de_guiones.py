"""Recorta las plantillas de guiones y separa la conversación de ejemplo.

Revision ID: c8d3e5f7a9b1
Revises: f2a7c9e1b3d4
Create Date: 2026-11-09

Las plantillas «Guiones de WhatsApp por etapa del funnel», «Mapa dolor →
solución» y «Playbook de objeciones» se escribieron para una clínica concreta
y traían su dirección, sus medios de pago, montos, referencias a documentos
de un vault que acá no existe, nombres de autores de ventas y promesas de
resultado («el vello ya no vuelve»). Toda clínica nueva las heredaba. El
panel del 2026-11-09 decidió recortarlas, no quitarlas, y mover la
conversación canónica a su propia plantilla.

Publica el contenido nuevo de ``scripts/knowledge_templates/`` para esas
plantillas y crea la de la conversación de ejemplo. Solo pisa una plantilla
que sigue en su versión 1 (nunca editada por el operador); las copias que los
negocios ya importaron no se tocan: son suyas. Para DermicaPro hay una lista
aparte (docs/analisis/13).
"""

from pathlib import Path
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import context, op

revision: str = "c8d3e5f7a9b1"
down_revision: Union[str, None] = "f2a7c9e1b3d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LIBRARY = Path(__file__).resolve().parents[2] / "scripts" / "knowledge_templates"
_FIELDS = ("title", "document_type", "service_hint")
TITLES = (
    # Dos fichas traían el mismo tipo de resto (un autor, la herramienta de n8n).
    "Ficha: Hollywood Peel",
    "Ficha: Limpieza facial",
    "Mapa dolor → solución",
    "Playbook de objeciones",
    "Guiones de WhatsApp por etapa del funnel",
    "Conversación de ejemplo: de la pregunta de precio a la cita",
)

_templates = sa.table(
    "knowledge_templates",
    sa.column("title", sa.Text),
    sa.column("document_type", sa.Text),
    sa.column("service_hint", sa.Text),
    sa.column("content", sa.Text),
    schema="public",
)


def _library() -> dict[str, dict]:
    """Mismo formato que lee ``scripts.seed_knowledge_templates``, parseado acá
    para que la migración no dependa de un módulo que puede cambiar."""

    items: dict[str, dict] = {}
    if not LIBRARY.is_dir():
        return items
    for path in sorted(LIBRARY.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        header, _, body = text.removeprefix("---\n").partition("\n---\n")
        values = dict.fromkeys(_FIELDS)
        for line in header.splitlines():
            key, _, value = line.partition(":")
            if key.strip() in _FIELDS:
                values[key.strip()] = value.strip() or None
        if values["title"] in TITLES and body.strip():
            items[values["title"]] = {**values, "content": body.strip()}
    return items


def upgrade() -> None:
    if context.config.attributes.get("tenant_schema"):
        return
    bind = op.get_bind()
    library = _library()
    rows = bind.execute(
        sa.text("SELECT title, version, content FROM public.knowledge_templates WHERE title = ANY(:titles)"),
        {"titles": list(TITLES)},
    ).mappings().all()
    existing = {row["title"]: row for row in rows}
    for title, item in library.items():
        current = existing.get(title)
        if current is None:
            op.bulk_insert(_templates, [item])
        elif current["version"] == 1 and current["content"] != item["content"]:
            bind.execute(
                sa.text(
                    "UPDATE public.knowledge_templates SET content = :content, version = 2, updated_at = now() "
                    "WHERE title = :title AND version = 1"
                ),
                {"content": item["content"], "title": title},
            )


def downgrade() -> None:
    if context.config.attributes.get("tenant_schema"):
        return
    # El texto anterior no se guarda: la versión queda en 2 y la plantilla de
    # la conversación de ejemplo se retira si nadie la editó.
    op.get_bind().execute(
        sa.text("DELETE FROM public.knowledge_templates WHERE version = 1 AND title = :title"),
        {"title": TITLES[-1]},
    )
