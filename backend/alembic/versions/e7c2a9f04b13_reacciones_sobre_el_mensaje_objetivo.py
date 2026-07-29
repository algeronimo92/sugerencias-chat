"""reacciones sobre el mensaje objetivo

Revision ID: e7c2a9f04b13
Revises: d4e8f1a2b6c9
Create Date: 2026-07-28

Hasta ahora una reacción de WhatsApp entraba como un mensaje propio
(`message_type='reaction'`, el emoji en `content`, el id del reaccionado en
`payload.target_wa_message_id`) y se pintaba como una burbuja aparte. WhatsApp
la muestra como un badge pegado a la esquina del mensaje al que se reaccionó,
no como mensaje.

Esta columna mueve la reacción al mensaje objetivo: una lista de
`{emoji, from_me}` (a lo sumo una entrada por lado en un chat 1:1). Las
reacciones dejan de ser filas — se mergean acá, tanto las que entran por el
webhook como las que manda el vendedor desde la app.

`wsp_messages` está en EXTERNAL_TABLES (ver alembic/env.py), así que el DDL va
a mano con IF NOT EXISTS para ser idempotente. Aditiva: nace NULL. El backfill
de la única fila legada de reacción va aparte (scripts/backfill_reactions.py).
"""

from typing import Sequence, Union

from alembic import op

revision: str = "e7c2a9f04b13"
down_revision: Union[str, None] = "d4e8f1a2b6c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE wsp_messages ADD COLUMN IF NOT EXISTS reactions JSONB")


def downgrade() -> None:
    op.execute("ALTER TABLE wsp_messages DROP COLUMN IF EXISTS reactions")
