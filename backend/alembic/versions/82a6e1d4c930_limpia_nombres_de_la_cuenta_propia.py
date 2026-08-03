"""Limpia nombres de la cuenta propia guardados como si fueran del lead.

Revision ID: 82a6e1d4c930
Revises: 6d1f0a9c3e42
"""

from typing import Sequence, Union

from alembic import op


revision: str = "82a6e1d4c930"
down_revision: Union[str, None] = "6d1f0a9c3e42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Evolution usa estos pushName en eventos fromMe. Al dejarlos en NULL, la
    # interfaz muestra el teléfono o el fallback genérico del contacto.
    op.execute(
        """
        UPDATE leads
        SET nombre = NULL,
            updated_at = now()
        WHERE lower(trim(nombre)) IN ('você', 'voce', 'dermicapro', 'dermica pro', 'DérmicaPRO)
        """
    )


def downgrade() -> None:
    # Esos valores no identificaban al contacto; no deben restaurarse.
    pass
