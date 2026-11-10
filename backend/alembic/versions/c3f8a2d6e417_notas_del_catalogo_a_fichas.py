"""lo que el catálogo decía de cada servicio pasa a una ficha de conocimiento

Revision ID: c3f8a2d6e417
Revises: b7d2f4a8c913
Create Date: 2026-11-08

Cada servicio tenía dos textos para la IA en su tarjeta del catálogo: qué
problema resuelve y para quién (``description``) y sus condiciones
(``price_notes``). Lo que explica un servicio es contenido de sus fichas de
conocimiento, que ya se vinculan al servicio y el copiloto prioriza; tenerlo
en dos lugares obligaba al negocio a decidir dónde escribir y le mandaba al
modelo, en cada sugerencia, el texto de todos los servicios activos.

La pantalla deja de mostrar esos campos y el copiloto deja de leerlos. Para
que nada de lo cargado se pierda, esta revisión copia cada texto no vacío a
un documento ``ficha`` del mismo servicio, con un solo fragmento (cabe: los
campos admitían 1000 y 500 caracteres). Si el negocio lo edita, se fragmenta
como cualquier otro documento.

Las columnas no se borran acá: durante el despliegue la versión anterior sigue
atendiendo y las lee. Las borra la revisión siguiente.

Es idempotente (marca lo que copió en ``metadata.migrated_from``) y corre igual
en cada schema: el de cada negocio y public.
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c3f8a2d6e417"
down_revision: Union[str, None] = "b7d2f4a8c913"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

MARKER = "lead_services"


def _has_tables(bind) -> bool:
    found = bind.execute(sa.text(
        "SELECT count(*) FROM information_schema.tables "
        "WHERE table_schema = current_schema() "
        "AND table_name IN ('lead_services', 'knowledge_documents', 'knowledge_chunks')"
    )).scalar_one()
    return found == 3


def _content(description: str | None, price_notes: str | None) -> str:
    parts = []
    if description and description.strip():
        parts.append(f"Qué problema resuelve y para quién es:\n{description.strip()}")
    if price_notes and price_notes.strip():
        parts.append(f"Condiciones (promociones, vigencia):\n{price_notes.strip()}")
    return "\n\n".join(parts)


def upgrade() -> None:
    bind = op.get_bind()
    if not _has_tables(bind):
        return
    services = bind.execute(sa.text(
        "SELECT s.id, s.name, s.description, s.price_notes FROM lead_services s "
        "WHERE (btrim(coalesce(s.description, '')) <> '' OR btrim(coalesce(s.price_notes, '')) <> '') "
        "AND NOT EXISTS (SELECT 1 FROM knowledge_documents d "
        "                WHERE d.service_id = s.id AND d.metadata->>'migrated_from' = :marker) "
        "ORDER BY s.id"
    ), {"marker": MARKER}).mappings().all()
    for service in services:
        content = _content(service["description"], service["price_notes"])
        document_id = bind.execute(sa.text(
            "INSERT INTO knowledge_documents (title, document_type, content, service_id, metadata) "
            "VALUES (:title, 'ficha', :content, :service_id, CAST(:metadata AS jsonb)) RETURNING id"
        ), {
            "title": f"{service['name']} · lo que decía el catálogo"[:200],
            "content": content,
            "service_id": service["id"],
            "metadata": json.dumps({"migrated_from": MARKER}),
        }).scalar_one()
        bind.execute(sa.text(
            "INSERT INTO knowledge_chunks (document_id, content, ordinal) VALUES (:document_id, :content, 0)"
        ), {"document_id": document_id, "content": content})


def downgrade() -> None:
    bind = op.get_bind()
    if not _has_tables(bind):
        return
    # Los textos siguen en las columnas: basta con quitar las copias.
    bind.execute(sa.text(
        "DELETE FROM knowledge_documents WHERE metadata->>'migrated_from' = :marker"
    ), {"marker": MARKER})
