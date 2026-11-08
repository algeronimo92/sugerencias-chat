"""embeddings de los fragmentos de conocimiento, para la búsqueda híbrida

Revision ID: e6b1d9a4c752
Revises: c3f8a2d6e417
Create Date: 2026-11-08

La búsqueda solo por palabras no relaciona lo que escribe el cliente ("tengo la
cara caída") con lo que dice la ficha ("flacidez"). Cada fragmento guarda ahora
su embedding y el modelo que lo generó; la búsqueda combina palabras y
significado (``knowledge_vectors``).

Solo agrega columnas que admiten nulos: la versión anterior, que convive con la
nueva durante el despliegue, no las ve. No calcula vectores acá (necesita la
clave de IA de cada negocio): los completa la primera sugerencia.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "e6b1d9a4c752"
down_revision: Union[str, None] = "c3f8a2d6e417"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("knowledge_chunks", sa.Column("embedding", postgresql.ARRAY(sa.REAL()), nullable=True))
    op.add_column("knowledge_chunks", sa.Column("embedding_model", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("knowledge_chunks", "embedding_model")
    op.drop_column("knowledge_chunks", "embedding")
