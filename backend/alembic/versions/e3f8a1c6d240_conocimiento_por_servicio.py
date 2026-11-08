"""Conocimiento por servicio: un documento puede pertenecer a un servicio.

Revision ID: e3f8a1c6d240
Revises: d7e1b4a93c25
Create Date: 2026-11-07

Las fichas, protocolos y objeciones de un servicio se cargan vinculados a
él; el copiloto prioriza los del servicio que le interesa al lead. Sin
servicio, el documento es conocimiento general (políticas, garantías).
Borrar el servicio deja el documento como general, no lo borra.

Plano tenant: corre en cada schema. ``migrate.py`` también recorre public,
donde puede no existir ``knowledge_documents``: ahí no se hace nada.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e3f8a1c6d240"
down_revision: Union[str, None] = "d7e1b4a93c25"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "knowledge_documents") or not _table_exists(bind, "lead_services"):
        return
    op.add_column("knowledge_documents", sa.Column("service_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "knowledge_documents_service_id_fkey", "knowledge_documents", "lead_services",
        ["service_id"], ["id"], ondelete="SET NULL",
    )
    op.create_index("idx_knowledge_documents_service", "knowledge_documents", ["service_id"])


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "knowledge_documents"):
        return
    op.drop_index("idx_knowledge_documents_service", table_name="knowledge_documents")
    op.drop_constraint("knowledge_documents_service_id_fkey", "knowledge_documents", type_="foreignkey")
    op.drop_column("knowledge_documents", "service_id")


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None
