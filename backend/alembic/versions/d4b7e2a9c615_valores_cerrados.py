"""valores cerrados con CHECK

Revision ID: d4b7e2a9c615
Revises: f0c3d8a2b6e1
Create Date: 2026-10-06

El contrato HTTP declara como enums el rol de usuario, el método de inicio
de sesión, el estado de la cola de un mensaje, el alcance de la pausa de una
ejecución y el tipo de evento de un reporte. El código ya escribía solo esos
valores; desde acá la base también lo garantiza, y por eso el backend puede
validarlos al responder sin riesgo de un 500 por un dato viejo.

Una base nueva ya los trae: la línea base crea el esquema desde los modelos,
que los declaran. Por eso cada CHECK se crea solo si falta.

Antes de crear cada CHECK se busca en los datos un valor fuera del conjunto.
Si aparece uno, la migración se detiene sin tocar nada y dice qué tabla,
qué columna y qué valores: hay que decidir a mano qué hacer con ellos (no se
reescriben solos porque no se sabe qué significaban).
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4b7e2a9c615"
down_revision: Union[str, None] = "f0c3d8a2b6e1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (tabla, columna, valores permitidos, nombre del CHECK). NULL siempre pasa.
CLOSED_VALUES = (
    ("users", "role", ("admin", "vendedor"), "users_role_check"),
    ("auth_sessions", "auth_method", ("password", "pin"), "auth_sessions_auth_method_check"),
    (
        "wsp_messages",
        "outbox_status",
        ("queued", "sending", "sent", "retryable_failed", "failed", "discarded"),
        "wsp_messages_outbox_status_check",
    ),
    ("automation_executions", "pause_scope", ("lead", "execution"), "ck_automation_executions_pause_scope"),
    (
        "issue_report_events",
        "event_type",
        ("created", "status_changed", "priority_changed"),
        "issue_report_events_event_type_check",
    ),
)


class UnexpectedValuesError(RuntimeError):
    """Hay datos fuera del conjunto que el contrato declara."""


def _in_list(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    bind = op.get_bind()
    problems = []
    for table, column, allowed, _name in CLOSED_VALUES:
        found = bind.execute(sa.text(
            f"SELECT {column} AS value, count(*) AS total FROM {table} "
            f"WHERE {column} IS NOT NULL AND {column} NOT IN ({_in_list(allowed)}) "
            f"GROUP BY {column} ORDER BY {column}"
        )).all()
        if found:
            detail = ", ".join(f"{row.value!r} ({row.total} filas)" for row in found)
            problems.append(f"{table}.{column}: {detail}; permitidos: {_in_list(allowed)}")
    if problems:
        raise UnexpectedValuesError(
            "Valores fuera del contrato; corregirlos antes de migrar:\n  " + "\n  ".join(problems)
        )
    for table, column, allowed, name in CLOSED_VALUES:
        if not _constraint_exists(bind, table, name):
            op.create_check_constraint(name, table, f"{column} IN ({_in_list(allowed)})")


def _constraint_exists(bind, table: str, name: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM pg_constraint c "
        "JOIN pg_class t ON t.oid = c.conrelid "
        "JOIN pg_namespace n ON n.oid = t.relnamespace "
        "WHERE c.conname = :name AND t.relname = :table AND n.nspname = current_schema()"
    ), {"name": name, "table": table}).first() is not None


def downgrade() -> None:
    for table, _column, _allowed, name in reversed(CLOSED_VALUES):
        op.drop_constraint(name, table, type_="check")
