"""Encabezado de imagen para plantillas oficiales (media handle de Meta).

Revision ID: b7d4e19a3f52
Revises: a3c6f28d914b
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b7d4e19a3f52"
down_revision: Union[str, None] = "a3c6f28d914b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "message_templates",
        sa.Column("official_header_media_asset_id", sa.Integer(), nullable=True),
    )
    op.create_foreign_key(
        "fk_message_templates_official_header_media_asset_id",
        "message_templates", "media_assets",
        ["official_header_media_asset_id"], ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_message_templates_official_header_media_asset_id",
        "message_templates", type_="foreignkey",
    )
    op.drop_column("message_templates", "official_header_media_asset_id")
