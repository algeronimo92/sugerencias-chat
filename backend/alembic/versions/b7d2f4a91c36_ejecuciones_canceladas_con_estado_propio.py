"""Las ejecuciones que alguien detuvo pasan de ``skipped`` a ``cancelled``.

Hasta acá cancelar una ejecución la dejaba en ``skipped`` con un texto en
``error``, igual que las que el motor descartó porque no aplicaban. En el
historial se leían juntas como «Omitida»: 655 de las 718 de DermicaPro eran
cancelaciones (643 a mano y 12 por pausar la automatización).

Solo se mueven las filas cuyo texto escribió el propio backend al cancelar.
Lo demás sigue en ``skipped``, que ahora significa una sola cosa: no aplicó.

``status`` es texto sin CHECK: no hay DDL, solo datos.

Plano tenant: corre en cada schema. ``migrate.py`` también recorre public,
donde ``automation_executions`` no existe: ahí no hay nada que cambiar.

Revision ID: b7d2f4a91c36
Revises: a3c7e5d19b42
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b7d2f4a91c36"
down_revision: Union[str, None] = "a3c7e5d19b42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "automation_executions"
# Los tres textos con los que el backend marcaba una cancelación
# (sql_executions.cancel, engine.run_execution y sql_rules.retire).
CANCEL_REASONS = (
    "Cancelada manualmente",
    "La regla fue desactivada",
    "La automatización fue eliminada",
)


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def _move(source: str, target: str) -> None:
    if not _table_exists(op.get_bind(), TABLE):
        return
    # Constantes de este archivo, no input: se escriben literales para que la
    # sentencia sea la misma en línea y en `alembic upgrade --sql`.
    reasons = ", ".join("'" + reason + "'" for reason in CANCEL_REASONS)
    op.execute(
        f"UPDATE {TABLE} SET status = '{target}' WHERE status = '{source}' AND error IN ({reasons})"
    )


def upgrade() -> None:
    _move("skipped", "cancelled")


def downgrade() -> None:
    _move("cancelled", "skipped")
