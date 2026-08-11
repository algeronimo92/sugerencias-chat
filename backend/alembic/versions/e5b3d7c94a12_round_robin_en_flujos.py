"""round robin en flujos visuales

Revision ID: e5b3d7c94a12
Revises: a2f7b4c81d63
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "e5b3d7c94a12"
down_revision: Union[str, None] = "a2f7b4c81d63"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Turno actual de cada bloque Round robin. La clave es (regla, bloque)
    # porque el reparto es del bloque y no del lead: cada ejecución que pasa
    # por ahí avanza el contador y sale por la salida siguiente.
    op.create_table(
        "automation_round_robin_state",
        sa.Column(
            "rule_id",
            sa.Integer(),
            sa.ForeignKey("automation_rules.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column("node_id", sa.Text(), primary_key=True),
        sa.Column("counter", sa.BigInteger(), nullable=False, server_default="0"),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("automation_round_robin_state")
