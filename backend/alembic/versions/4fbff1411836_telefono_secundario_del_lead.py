"""Telefono secundario del lead: un numero informativo (llamadas, contacto
alternativo) distinto del que WhatsApp usa para enrutar mensajes. No pasa por
whatsapp_identities ni por los triggers de 028 -- es solo un dato mostrado en
el CRM, sin efecto en a quien se le manda el proximo mensaje.

Revision ID: 4fbff1411836
Revises: b0ff6e84c3c4
Create Date: 2026-08-28 17:08:46.646662
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = '4fbff1411836'
down_revision: Union[str, None] = 'b0ff6e84c3c4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("leads", sa.Column("telefono_secundario", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("leads", "telefono_secundario")
