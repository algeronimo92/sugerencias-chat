"""Aliases LID/telefono de WhatsApp para evitar leads duplicados.

Revision ID: f4a8c2d91e07
Revises: 9f2b7c4d81a6
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "f4a8c2d91e07"
down_revision: Union[str, None] = "9f2b7c4d81a6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "whatsapp_identities",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("instance", sa.Text(), nullable=False),
        sa.Column("jid", sa.Text(), nullable=False),
        sa.Column("kind", sa.Text(), nullable=False),
        sa.Column("lead_id", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "kind IN ('phone', 'lid')", name="whatsapp_identities_kind_check"
        ),
        sa.ForeignKeyConstraint(
            ["lead_id"],
            ["leads.remote_jid"],
            ondelete="CASCADE",
            onupdate="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_whatsapp_identities_instance_jid",
        "whatsapp_identities",
        ["instance", "jid"],
        unique=True,
    )
    op.create_index(
        "idx_whatsapp_identities_lead",
        "whatsapp_identities",
        ["lead_id"],
        unique=False,
    )

def downgrade() -> None:
    op.drop_index("idx_whatsapp_identities_lead", table_name="whatsapp_identities")
    op.drop_index("uq_whatsapp_identities_instance_jid", table_name="whatsapp_identities")
    op.drop_table("whatsapp_identities")
