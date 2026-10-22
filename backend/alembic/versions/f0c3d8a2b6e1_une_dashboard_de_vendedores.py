"""Une la rama del dashboard de vendedores con la de Meta Cloud API nativa.

Las dos ramas salieron de b7d4e19a3f52. La del dashboard (d1a5e83c47b9 y
a7f2c48d16be) ya pudo haberse aplicado en producción desde main, así que se
conservan con su `down_revision` original y esta revisión solo une las dos
cabezas: reencadenarlas haría que Alembic creyera aplicada toda la otra rama.
Ninguna toca lo que la otra cambia (solo agregan columnas e índices), así que
el orden en que se apliquen no importa.

Revision ID: f0c3d8a2b6e1
Revises: a6d2e9b41c73, a7f2c48d16be
"""

from typing import Sequence, Union


revision: str = "f0c3d8a2b6e1"
down_revision: Union[str, Sequence[str], None] = ("a6d2e9b41c73", "a7f2c48d16be")
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
