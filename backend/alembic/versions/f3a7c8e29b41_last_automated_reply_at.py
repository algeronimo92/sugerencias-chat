"""Distinguir respuesta de bot vs. lectura de vendedor en el badge de no leídos.

Responder (manual o por automatización) ya marca last_read_at, pero eso
confunde "un bot ya contestó" con "el vendedor ya vio el mensaje". Esta
columna guarda cuándo fue la última respuesta que vino de una automatización
o mensaje programado (sin actor_user_id humano detrás), para que el frontend
pueda pintar el badge de no leídos con un color distinto cuando el chat está
"atendido por bot" pero ningún vendedor lo revisó todavía.

Revision ID: f3a7c8e29b41
Revises: d5b9e3a71c48
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f3a7c8e29b41"
down_revision: Union[str, None] = "d5b9e3a71c48"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "leads",
        sa.Column("last_automated_reply_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("leads", "last_automated_reply_at")
