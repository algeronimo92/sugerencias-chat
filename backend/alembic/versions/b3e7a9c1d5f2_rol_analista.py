"""Rol analista: solo mira el dashboard.

Revision ID: b3e7a9c1d5f2
Revises: e4b8d2f6a913
Create Date: 2026-11-09

Hasta acá un usuario era admin o vendedor. El negocio quiere dar acceso a
las métricas a alguien que no atiende chats (dirección, un contador, una
agencia), sin abrirle el CRM entero. El CHECK de ``users.role`` admite el
valor nuevo; qué rutas puede pedir lo decide ``app/modules/auth/role_policy.py``.

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


def _replace_check(allowed: tuple[str, ...]) -> None:
    values = ", ".join(f"'{value}'" for value in allowed)
    op.drop_constraint(CHECK_NAME, "users", type_="check")
    op.create_check_constraint(CHECK_NAME, "users", f"role IN ({values})")


def upgrade() -> None:
    _replace_check(("admin", "vendedor", "analista"))


def downgrade() -> None:
    analysts = op.get_bind().execute(
        sa.text("SELECT count(*) FROM users WHERE role = 'analista'")
    ).scalar_one()
    if analysts:
        raise RuntimeError(
            f"Hay {analysts} usuario(s) con rol 'analista'; cambiarles el rol antes de volver atrás."
        )
    _replace_check(("admin", "vendedor"))
