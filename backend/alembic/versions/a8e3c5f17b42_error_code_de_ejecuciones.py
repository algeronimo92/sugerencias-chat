"""error_code en las ejecuciones de automatizaciones

Revision ID: a8e3c5f17b42
Revises: d4b7e2a9c615
Create Date: 2026-10-07

La UI distinguía el fallo por ventana de 24 h cerrada leyendo el texto del
error. Desde acá la causa viaja en su propia columna, con un CHECK que cierra
los valores posibles.

Las ejecuciones que ya fallaron por esa causa se reconocen por última vez por
su texto, que el backend escribía siempre igual, y quedan con el código.

Una base nueva ya trae la columna y el CHECK (la línea base crea el esquema
desde los modelos): cada paso se hace solo si falta.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a8e3c5f17b42"
down_revision: Union[str, None] = "d4b7e2a9c615"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "automation_executions"
CHECK_NAME = "ck_automation_executions_error_code"
SERVICE_WINDOW_CLOSED = "service_window_closed"
# Texto con el que el backend marcaba ese fallo (SERVICE_WINDOW_CLOSED_ERROR).
SERVICE_WINDOW_CLOSED_TEXT = "No se envió WhatsApp porque la ventana de 24 horas está cerrada"


def upgrade() -> None:
    bind = op.get_bind()
    if not _column_exists(bind, TABLE, "error_code"):
        op.add_column(TABLE, sa.Column("error_code", sa.Text(), nullable=True))
    bind.execute(sa.text(
        f"UPDATE {TABLE} SET error_code = :code "
        "WHERE error_code IS NULL AND status = 'failed' AND error = :text"
    ), {"code": SERVICE_WINDOW_CLOSED, "text": SERVICE_WINDOW_CLOSED_TEXT})
    if not _constraint_exists(bind, TABLE, CHECK_NAME):
        op.create_check_constraint(CHECK_NAME, TABLE, f"error_code IN ('{SERVICE_WINDOW_CLOSED}')")


def _column_exists(bind, table: str, column: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND table_name = :table AND column_name = :column"
    ), {"table": table, "column": column}).first() is not None


def _constraint_exists(bind, table: str, name: str) -> bool:
    return bind.execute(sa.text(
        "SELECT 1 FROM pg_constraint c "
        "JOIN pg_class t ON t.oid = c.conrelid "
        "JOIN pg_namespace n ON n.oid = t.relnamespace "
        "WHERE c.conname = :name AND t.relname = :table AND n.nspname = current_schema()"
    ), {"name": name, "table": table}).first() is not None


def downgrade() -> None:
    op.drop_constraint(CHECK_NAME, TABLE, type_="check")
    op.drop_column(TABLE, "error_code")
