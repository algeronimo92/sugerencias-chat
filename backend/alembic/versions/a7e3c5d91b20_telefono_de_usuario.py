"""Teléfono de WhatsApp de cada usuario del equipo.

Revision ID: a7e3c5d91b20
Revises: c4d8e2f61a93

Lo usa el aviso de cita al equipo: el responsable y los admins reciben la
venta nueva por WhatsApp. Nulo es "sin teléfono": ese usuario solo se entera
en la app. Se guarda en E.164 sin "+", como el ``wa_id`` de Meta.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "a7e3c5d91b20"
down_revision: Union[str, None] = "c4d8e2f61a93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "phone")
