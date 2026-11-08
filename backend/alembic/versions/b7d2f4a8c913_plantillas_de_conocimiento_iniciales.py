"""Publica la biblioteca inicial de plantillas de conocimiento.

Revision ID: b7d2f4a8c913
Revises: f4a2c7e9b815
Create Date: 2026-11-08

Las 19 plantillas de ``scripts/knowledge_templates/`` (fichas de
procedimientos, mapa dolor → solución, playbook de objeciones y guiones) eran
el índice del workflow de sugerencias de n8n y no se migraron cuando las
sugerencias pasaron al CRM. Se cargan acá porque el despliegue corre las
migraciones solo y nadie tiene que entrar al servidor a correr el script.

Solo inserta las que faltan por título: no pisa una plantilla que el operador
ya editó o publicó a mano. Para actualizar contenido después está
``python -m scripts.seed_knowledge_templates --apply`` o el panel de plataforma.
"""

from pathlib import Path
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import context, op

revision: str = "b7d2f4a8c913"
down_revision: Union[str, None] = "f4a2c7e9b815"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

LIBRARY = Path(__file__).resolve().parents[2] / "scripts" / "knowledge_templates"
_FIELDS = ("title", "document_type", "service_hint")

_templates = sa.table(
    "knowledge_templates",
    sa.column("title", sa.Text),
    sa.column("document_type", sa.Text),
    sa.column("service_hint", sa.Text),
    sa.column("content", sa.Text),
    schema="public",
)


def _library() -> list[dict]:
    """Mismo formato que lee ``scripts.seed_knowledge_templates``, parseado acá
    para que la migración no dependa de un módulo que puede cambiar."""

    if not LIBRARY.is_dir():
        return []
    items = []
    for path in sorted(LIBRARY.glob("*.md")):
        text = path.read_text(encoding="utf-8")
        header, _, body = text.removeprefix("---\n").partition("\n---\n")
        values = dict.fromkeys(_FIELDS)
        for line in header.splitlines():
            key, _, value = line.partition(":")
            if key.strip() in _FIELDS:
                values[key.strip()] = value.strip() or None
        if values["title"] and body.strip():
            items.append({**values, "content": body.strip()})
    return items


def upgrade() -> None:
    if context.config.attributes.get("tenant_schema"):
        return
    bind = op.get_bind()
    existing = set(bind.execute(sa.text("SELECT title FROM public.knowledge_templates")).scalars())
    missing = [item for item in _library() if item["title"] not in existing]
    if missing:
        op.bulk_insert(_templates, missing)


def downgrade() -> None:
    if context.config.attributes.get("tenant_schema"):
        return
    titles = [item["title"] for item in _library()]
    if titles:
        # Solo las que siguen tal cual se cargaron: una editada ya es del operador.
        op.get_bind().execute(
            sa.text("DELETE FROM public.knowledge_templates WHERE version = 1 AND title = ANY(:titles)"),
            {"titles": titles},
        )
