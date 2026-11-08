"""embeddings de los fragmentos de conocimiento con pgvector, para la búsqueda híbrida

Revision ID: e6b1d9a4c752
Revises: c3f8a2d6e417
Create Date: 2026-11-08

La búsqueda solo por palabras no relaciona lo que escribe el cliente ("tengo la
cara caída") con lo que dice la ficha ("flacidez"). Cada fragmento guarda ahora
su embedding (``vector(768)``) y el modelo que lo generó; la búsqueda combina
palabras y significado (``knowledge_vectors``).

- La extensión vive una sola vez en ``public``; la tabla de cada schema usa el
  tipo porque su search_path es ``"<tenant>", public``. La búsqueda de un
  negocio corre en su schema y nunca toca los vectores de otro.
- pgvector no es una extensión "trusted": crearla pide superusuario. En
  producción la crea el despliegue (``scripts/db-extensions.sh``) con el
  usuario administrador de la base, antes de migrar. Acá solo se crea si falta
  (desarrollo, CI). Si la imagen de PostgreSQL no trae pgvector, falla diciendo
  qué hacer en vez de con el error de PostgreSQL.
- Corre en cada schema y en ``public``. En producción ``public`` no tiene
  ``knowledge_chunks`` (vive solo en el schema de cada negocio): ahí no hace
  nada. El 2026-11-08 la primera versión de esta revisión agregaba las columnas
  sin mirar y el deploy falló en ``public`` con "relation knowledge_chunks does
  not exist" (se revirtió entero, sin aplicar nada); en desarrollo y en CI
  ``public`` sí tiene la tabla, por eso no se vio antes.
- Solo agrega columnas que admiten nulos: la versión anterior, que convive con
  la nueva durante el despliegue, no las ve. No calcula vectores (necesita la
  clave de IA de cada negocio): los completa la primera sugerencia.
- Sin índice HNSW a propósito: es aproximado y, con el filtro por modelo y por
  servicio, puede perder resultados. Con unos miles de fragmentos por negocio
  el recorrido exacto tarda milisegundos; si un negocio llegara a cientos de
  miles, se agrega.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector

revision: str = "e6b1d9a4c752"
down_revision: Union[str, None] = "c3f8a2d6e417"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_chunks(bind) -> bool:
    """En el schema activo (el del negocio que se está migrando, o public)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = 'knowledge_chunks'"
    )).first() is not None


def _ensure_extension(bind) -> None:
    if bind.execute(sa.text("SELECT 1 FROM pg_extension WHERE extname = 'vector'")).scalar():
        return
    if not bind.execute(sa.text("SELECT 1 FROM pg_available_extensions WHERE name = 'vector'")).scalar():
        raise RuntimeError(
            "PostgreSQL no tiene pgvector. La base tiene que correr con la imagen de db/Dockerfile "
            "(compose.db.yml y compose.yml la construyen) antes de aplicar esta migración."
        )
    # SCHEMA public explícito: sin él se crearía en el schema del tenant que
    # se esté migrando, el primero del search_path.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public")


def upgrade() -> None:
    bind = op.get_bind()
    _ensure_extension(bind)
    if not _has_chunks(bind):
        return
    op.add_column("knowledge_chunks", sa.Column("embedding", Vector(768), nullable=True))
    op.add_column("knowledge_chunks", sa.Column("embedding_model", sa.Text(), nullable=True))


def downgrade() -> None:
    # La extensión queda: la usan los schemas que no se bajaron.
    if not _has_chunks(op.get_bind()):
        return
    op.drop_column("knowledge_chunks", "embedding_model")
    op.drop_column("knowledge_chunks", "embedding")
