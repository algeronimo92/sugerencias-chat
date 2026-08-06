"""editar y eliminar mensajes

Revision ID: a2f7b4c81d63
Revises: d1a5b8c3e742
Create Date: 2026-08-06

WhatsApp deja reescribir un mensaje propio de texto (dentro de los 15 minutos)
y eliminarlo para todos. Hasta ahora la app solo sabía enviar: si el vendedor
corregía o borraba desde el teléfono, el CRM seguía mostrando el texto viejo.

Dos marcas de tiempo sobre la fila existente, no filas nuevas:

- ``edited_at``: cuándo se reescribió por última vez. `content` ya guarda el
  texto vigente; esta columna es la que habilita el "Editado" de la burbuja.
- ``deleted_at``: cuándo se eliminó para todos. Es un borrado lógico —  la fila
  queda para la auditoría del CRM, pero la API deja de servir su contenido y el
  hilo pinta la lápida ("Se eliminó este mensaje"), igual que WhatsApp.

`wsp_messages` está en EXTERNAL_TABLES (ver alembic/env.py), así que el DDL va
a mano con IF NOT EXISTS para ser idempotente. Aditiva: ambas nacen NULL, que
es exactamente "ni editado ni eliminado".
"""

from typing import Sequence, Union

from alembic import op

revision: str = "a2f7b4c81d63"
down_revision: Union[str, None] = "d1a5b8c3e742"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TABLE wsp_messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMPTZ")
    op.execute("ALTER TABLE wsp_messages ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ")


def downgrade() -> None:
    op.execute("ALTER TABLE wsp_messages DROP COLUMN IF EXISTS deleted_at")
    op.execute("ALTER TABLE wsp_messages DROP COLUMN IF EXISTS edited_at")
