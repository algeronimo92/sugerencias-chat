"""responder a un mensaje citado

Revision ID: c3f1d7a95b42
Revises: a5b229ee1c70
Create Date: 2026-07-27

Guarda a que mensaje responde cada mensaje, igual que hace WhatsApp: por el
id de WhatsApp (`key.id`), no por la clave primaria interna. Es el unico
identificador que comparten los dos lados de la integracion — Evolution lo
manda en `contextInfo.stanzaId` cuando el cliente responde, y es lo que hay
que enviarle de vuelta para que la cita se vea en el telefono.

No hace falta indice propio: la resolucion a la fila local busca por
wa_message_id, y a5b229ee1c70 dejo `idx_wsp_messages_wa_message_id` como
UNIQUE parcial sobre esa columna. Al ser unico devuelve como mucho una fila
por valor, asi que un indice compuesto (chat_id, wa_message_id) no leeria
menos y si costaria escrituras en la tabla mas caliente de la base.

`wsp_messages` esta en EXTERNAL_TABLES (ver alembic/env.py), asi que
autogenerate no la mira: el DDL va escrito a mano y con IF NOT EXISTS.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "c3f1d7a95b42"
down_revision: Union[str, None] = "a5b229ee1c70"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE wsp_messages ADD COLUMN IF NOT EXISTS quoted_wa_message_id TEXT")


def downgrade() -> None:
    op.execute("ALTER TABLE wsp_messages DROP COLUMN IF EXISTS quoted_wa_message_id")
