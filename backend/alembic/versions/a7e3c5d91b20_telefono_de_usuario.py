"""Teléfono de WhatsApp de cada usuario del equipo.

Revision ID: a7e3c5d91b20
Revises: c4d8e2f61a93

Lo usa el aviso de cita al equipo: el responsable y los admins reciben la
venta nueva por WhatsApp. Nulo es "sin teléfono": ese usuario solo se entera
en la app. Se guarda en E.164 sin "+", como el ``wa_id`` de Meta.

Plano tenant: corre en cada schema, también en `public`, que en producción ya
no tiene `users`. Donde no hay `users` no hace nada; sin ese resguardo el
deploy del 2026-11-12 se detuvo con "relation users does not exist" (no llegó
a aplicarse en ningún schema: el DDL es transaccional y `public` va primero).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "a7e3c5d91b20"
down_revision: Union[str, None] = "c4d8e2f61a93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def upgrade() -> None:
    if not _table_exists(op.get_bind(), "users"):
        return
    op.add_column("users", sa.Column("phone", sa.Text(), nullable=True))


def downgrade() -> None:
    if not _table_exists(op.get_bind(), "users"):
        return
    op.drop_column("users", "phone")
