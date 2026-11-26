"""Cada negocio tiene un paquete (Básico, Esencial o Profesional).

Hasta ahora los paquetes existían solo en la página pública: todo negocio
tenía todas las funciones y lo único limitable era la IA. La columna dice qué
paquete paga cada uno; qué trae cada paquete es código
(``app/modules/platform/plans.py``).

Los negocios existentes quedan en ``profesional``, que es tener todo: nadie
pierde una función que ya usaba por esta migración. La plataforma les asigna
el paquete real desde el panel.

Plano de control: solo corre en ``public``, una vez.

Revision ID: c8d2f6a4e913
Revises: a3c7e1f95b20
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import context, op


revision: str = "c8d2f6a4e913"
down_revision: Union[str, None] = "a3c7e1f95b20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if context.config.attributes.get("tenant_schema"):
        return
    op.add_column(
        "organizations",
        sa.Column("plan", sa.Text(), server_default="profesional", nullable=False),
        schema="public",
    )
    op.create_check_constraint(
        "organizations_plan_check",
        "organizations",
        "plan IN ('basico', 'esencial', 'profesional')",
        schema="public",
    )


def downgrade() -> None:
    if context.config.attributes.get("tenant_schema"):
        return
    op.drop_constraint("organizations_plan_check", "organizations", schema="public", type_="check")
    op.drop_column("organizations", "plan", schema="public")
