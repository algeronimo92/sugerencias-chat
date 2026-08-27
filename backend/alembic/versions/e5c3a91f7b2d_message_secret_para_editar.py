"""message_secret para descifrar ediciones nativas

Revision ID: e5c3a91f7b2d
Revises: c1d9f4a63e02
Create Date: 2026-08-27

Desde ~mayo 2026 WhatsApp manda la edición hecha desde la app nativa (no desde
el CRM) como `secretEncryptedMessage`: un evento cifrado que Evolution API no
descifra y hoy cae en `message_type = 'unsupported'` (ver el comentario en
services/automation_rules.py, que documenta el mismo caso para el motor de
automatizaciones y no cambia con esta migración).

`messageContextInfo.messageSecret` viaja sin filtrar en el webhook original de
CUALQUIER mensaje de Evolution, pero hasta ahora no se guardaba en ningún lado.
Esta columna lo persiste para poder derivar la clave de descifrado el día que
llegue la edición cifrada — ver services/message_edit_crypto.py. Nunca se
expone en la API ni al frontend.

`wsp_messages` está en EXTERNAL_TABLES (ver alembic/env.py), así que el DDL va
a mano con IF NOT EXISTS para ser idempotente. Aditiva: nace NULL, que es
"todavía no se guardó un secreto para este mensaje".
"""

from typing import Sequence, Union

from alembic import op

revision: str = "e5c3a91f7b2d"
down_revision: Union[str, None] = "c1d9f4a63e02"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE wsp_messages ADD COLUMN IF NOT EXISTS message_secret BYTEA")


def downgrade() -> None:
    op.execute("ALTER TABLE wsp_messages DROP COLUMN IF EXISTS message_secret")
