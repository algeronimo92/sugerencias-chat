"""Rol analista: solo mira el dashboard.

Revision ID: b3e7a9c1d5f2
Revises: e4b8d2f6a913
Create Date: 2026-11-09

Hasta acá un usuario era admin o vendedor. El negocio quiere dar acceso a
las métricas a alguien que no atiende chats (dirección, un contador, una
agencia), sin abrirle el CRM entero. El CHECK de ``users.role`` admite el
valor nuevo; qué rutas puede pedir lo decide ``app/modules/auth/role_policy.py``.

Plano tenant: corre en cada schema, también en `public`, que ya no tiene
las tablas del negocio. Donde no hay `users` no hace nada; sin ese resguardo
el deploy del 2026-11-10 se detuvo con "relation users does not exist".

Volver atrás solo es posible si ningún usuario quedó con ese rol: la
migración no decide por nadie qué otro rol debería tener.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b3e7a9c1d5f2"
down_revision: Union[str, None] = "e4b8d2f6a913"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CHECK_NAME = "users_role_check"


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def _replace_check(allowed: tuple[str, ...]) -> None:
    values = ", ".join(f"'{value}'" for value in allowed)
    op.drop_constraint(CHECK_NAME, "users", type_="check")
    op.create_check_constraint(CHECK_NAME, "users", f"role IN ({values})")


def upgrade() -> None:
    if not _table_exists(op.get_bind(), "users"):
        return
    _replace_check(("admin", "vendedor", "analista"))


def downgrade() -> None:
    if not _table_exists(op.get_bind(), "users"):
        return
    analysts = op.get_bind().execute(
        sa.text("SELECT count(*) FROM users WHERE role = 'analista'")
    ).scalar_one()
    if analysts:
        raise RuntimeError(
            f"Hay {analysts} usuario(s) con rol 'analista'; cambiarles el rol antes de volver atrás."
        )
    _replace_check(("admin", "vendedor"))
