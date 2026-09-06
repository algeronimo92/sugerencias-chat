"""Componentes reales (encabezado/pie/botones) y meta_template_id para plantillas oficiales.

Revision ID: a3c6f28d914b
Revises: c294b7a1f6d3
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "a3c6f28d914b"
down_revision: Union[str, None] = "c294b7a1f6d3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("message_templates", sa.Column("meta_template_id", sa.Text(), nullable=True))
    op.add_column(
        "message_templates",
        sa.Column("official_header_type", sa.Text(), nullable=False, server_default="none"),
    )
    op.add_column("message_templates", sa.Column("official_header_text", sa.Text(), nullable=True))
    op.add_column("message_templates", sa.Column("official_footer", sa.Text(), nullable=True))
    op.add_column(
        "message_templates",
        sa.Column("official_buttons", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default="[]"),
    )


def downgrade() -> None:
    op.drop_column("message_templates", "official_buttons")
    op.drop_column("message_templates", "official_footer")
    op.drop_column("message_templates", "official_header_text")
    op.drop_column("message_templates", "official_header_type")
    op.drop_column("message_templates", "meta_template_id")
