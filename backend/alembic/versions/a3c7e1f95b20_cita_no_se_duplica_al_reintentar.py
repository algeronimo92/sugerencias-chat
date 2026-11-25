"""Una cita no se duplica cuando se vuelve a guardar después de un corte.

Guardar una cita tarda de 7 a 10 s porque en el mismo pedido se crea el
evento de Google Calendar, se sincroniza n8n y salen los avisos de WhatsApp.
Si la conexión se cortaba en ese rato, la cita ya estaba guardada pero el
navegador mostraba un error; al volver a guardar se creaba otra, con sus
avisos y su evento. Medido el 2026-11-25 en producción: unos 30 pares (y un
trío) desde octubre, entre ellos las citas 425 y 426.

El formulario manda ahora un identificador por intento, el mismo en cada
reintento, y el backend devuelve la cita ya guardada si lo reconoce. El
índice único lo garantiza aunque dos pedidos lleguen a la vez.

Plano tenant: corre en cada schema, también en `public`, que no tiene
`appointments`: ahí no hace nada (sin el resguardo, el DDL fallaría ahí antes
de llegar a los negocios; ver a7e3c5d91b20).

Revision ID: a3c7e1f95b20
Revises: b5e9a2f7c063
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "a3c7e1f95b20"
down_revision: Union[str, None] = "b5e9a2f7c063"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def upgrade() -> None:
    if not _table_exists(op.get_bind(), "appointments"):
        return
    op.add_column("appointments", sa.Column("client_request_id", postgresql.UUID(as_uuid=False), nullable=True))
    op.create_index("uq_appointments_client_request_id", "appointments", ["client_request_id"], unique=True)


def downgrade() -> None:
    if not _table_exists(op.get_bind(), "appointments"):
        return
    op.drop_index("uq_appointments_client_request_id", table_name="appointments")
    op.drop_column("appointments", "client_request_id")
