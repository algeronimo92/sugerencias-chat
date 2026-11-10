"""Cuándo activó su cuenta cada usuario.

Revision ID: c4d8e2f61a93
Revises: b3e7a9c1d5f2
Create Date: 2026-11-10

``users.is_active`` en false significaba dos cosas distintas: una invitación
que nadie aceptó todavía y una persona que entró alguna vez y el admin
desactivó. El panel las mostraba juntas ("Invitación pendiente /
desactivado") y el backend no podía tratarlas distinto: corregir el correo,
reenviar o copiar el enlace de invitación solo tiene sentido en la primera;
en la segunda cambiar el correo abriría la puerta a entrar como esa persona
pidiendo un restablecimiento a la dirección nueva.

``activated_at`` lo pone el backend al aceptar la invitación. Quien hoy está
activo se da por activado al crearse. Quien hoy está desactivado y había
entrado alguna vez queda sin fecha: la base no guardó ese dato, así que el
panel lo mostrará como invitación pendiente hasta que se le reactive.

Plano tenant: corre en cada schema, también en `public`, donde no hay `users`.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c4d8e2f61a93"
down_revision: Union[str, None] = "b3e7a9c1d5f2"
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
    op.add_column("users", sa.Column("activated_at", sa.DateTime(timezone=True), nullable=True))
    op.execute("UPDATE users SET activated_at = created_at WHERE is_active")


def downgrade() -> None:
    if not _table_exists(op.get_bind(), "users"):
        return
    op.drop_column("users", "activated_at")
