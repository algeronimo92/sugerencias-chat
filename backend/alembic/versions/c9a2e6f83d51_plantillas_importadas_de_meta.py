"""Marca si una plantilla oficial fue importada desde Meta (no creada acá).

Borrar una plantilla creada por esta app también la borra de Meta (ver
routers/templates.py delete_template); una importada con "Importar desde
Meta" ya existía y fue aprobada fuera de la app, así que borrar el vínculo
local nunca debe borrar la plantilla real de la WABA.

Revision ID: c9a2e6f83d51
Revises: c4e8a1d6f239
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c9a2e6f83d51"
down_revision: Union[str, None] = "c4e8a1d6f239"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "message_templates",
        sa.Column("imported_from_meta", sa.Boolean(), nullable=False, server_default="false"),
    )


def downgrade() -> None:
    op.drop_column("message_templates", "imported_from_meta")
