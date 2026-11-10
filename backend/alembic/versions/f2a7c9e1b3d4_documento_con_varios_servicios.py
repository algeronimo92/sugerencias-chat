"""un documento de conocimiento puede ser la ficha de varios servicios

Revision ID: f2a7c9e1b3d4
Revises: e6b1d9a4c752
Create Date: 2026-11-09

"Botox - 1 Zona", "2 Zonas" y "3 Zonas" comparten la misma ficha, pero cada
documento solo podía vincularse a un servicio y había que duplicarlo. Los
vínculos pasan a ``knowledge_document_services`` (documento × servicio).

- ``knowledge_documents.service_id`` se conserva como espejo del primer
  servicio: durante el despliegue blue-green la versión anterior sigue
  leyéndolo (filtra por él en sus búsquedas). La siguiente revisión lo
  elimina. Mientras tanto, la nueva versión lo escribe junto con los vínculos.
- Corre en cada schema y en ``public``. En producción ``public`` no tiene
  ``knowledge_documents``: ahí no hace nada (misma guarda que e6b1d9a4c752).
- Borrar un servicio borra el vínculo (``ON DELETE CASCADE``), no la ficha:
  antes ``SET NULL`` la dejaba como conocimiento general.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "f2a7c9e1b3d4"
down_revision: Union[str, None] = "e6b1d9a4c752"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_documents(bind) -> bool:
    """En el schema activo (el del negocio que se está migrando, o public)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = 'knowledge_documents'"
    )).first() is not None


def upgrade() -> None:
    bind = op.get_bind()
    if not _has_documents(bind):
        return
    op.create_table(
        "knowledge_document_services",
        sa.Column(
            "document_id", postgresql.UUID(as_uuid=False),
            sa.ForeignKey("knowledge_documents.id", ondelete="CASCADE"), primary_key=True,
        ),
        sa.Column(
            "service_id", sa.Integer(),
            sa.ForeignKey("lead_services.id", ondelete="CASCADE"), primary_key=True,
        ),
    )
    op.create_index("idx_knowledge_document_services_service", "knowledge_document_services", ["service_id"])
    bind.execute(sa.text(
        "INSERT INTO knowledge_document_services (document_id, service_id) "
        "SELECT id, service_id FROM knowledge_documents WHERE service_id IS NOT NULL"
    ))


def downgrade() -> None:
    bind = op.get_bind()
    if not _has_documents(bind):
        return
    # El espejo ya trae el primer servicio; se recalcula por si la versión
    # nueva vinculó documentos que la anterior no conocía.
    bind.execute(sa.text(
        "UPDATE knowledge_documents AS d SET service_id = "
        "(SELECT min(ds.service_id) FROM knowledge_document_services AS ds WHERE ds.document_id = d.id)"
    ))
    op.drop_index("idx_knowledge_document_services_service", table_name="knowledge_document_services")
    op.drop_table("knowledge_document_services")
