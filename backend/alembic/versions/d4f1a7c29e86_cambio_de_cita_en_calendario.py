"""Cambio de una cita hecho a mano en Google Calendar, pendiente de confirmar.

Revision ID: d4f1a7c29e86
Revises: b8e4d2a6c193

El equipo reprograma o cambia el tratamiento editando el evento del
calendario, y la cita del CRM se queda con los datos viejos: el 2026-11-27
una paciente recibió tres recordatorios de "HIFU 12D" por una cita que ya
era de Botox. Ahora el worker anota lo que vio en el calendario
(``calendar_change_*``), avisa al equipo y retiene los recordatorios hasta
que alguien lo confirma. ``calendar_confirmed_summary`` es el título que ya
se confirmó: así el mismo título no vuelve a pedir confirmación.

Plano tenant: corre en cada schema, también en `public`, donde producción no
tiene `appointments`. Solo agrega las columnas donde la cita existe.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4f1a7c29e86"
down_revision: Union[str, None] = "b8e4d2a6c193"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "appointments"
COLUMNS = (
    ("calendar_change_summary", sa.Text()),
    ("calendar_change_starts_at", sa.DateTime(timezone=True)),
    ("calendar_change_detected_at", sa.DateTime(timezone=True)),
    ("calendar_confirmed_summary", sa.Text()),
)


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def upgrade() -> None:
    if not _table_exists(op.get_bind(), TABLE):
        return
    for name, type_ in COLUMNS:
        op.add_column(TABLE, sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    if not _table_exists(op.get_bind(), TABLE):
        return
    for name, _type in reversed(COLUMNS):
        op.drop_column(TABLE, name)
