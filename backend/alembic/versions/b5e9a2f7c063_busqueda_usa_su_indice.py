"""La búsqueda vuelve a usar su índice de texto.

Buscar en los mensajes recorría la tabla entera aunque existe un índice por
trigramas sobre ``f_unaccent(content)``. El 2026-11-24 unas pocas búsquedas
repetidas dejaron la base al 150 % de CPU; medido ese día en producción, un
texto que no aparece tardaba 4,2 s, y 0,14 s llamando a la función correcta.

La causa: había dos ``f_unaccent``. Las tablas de DermicaPro se mudaron de
``public`` a su schema con ``ALTER TABLE ... SET SCHEMA``, que se lleva los
índices tal como estaban: atados a ``public.f_unaccent``. Después el schema
recibió su propia copia de la función, y como va primero en el
``search_path``, las consultas llaman a esa. PostgreSQL solo usa un índice de
expresión si la consulta llama exactamente a la misma función, así que los
tres índices (mensajes, resumen de IA y nombre del lead) quedaron sin uso.

Se borra la copia del schema cuando ningún índice depende de ella: las
consultas pasan a resolver ``public.f_unaccent``, la de los índices. En un
negocio aprovisionado desde cero los índices sí dependen de la copia local,
que es la que las consultas encuentran: ahí no se toca nada. Sin ``CASCADE``:
si algo dependiera de la función, el borrado falla en vez de llevárselo.

Plano tenant: corre en cada schema. En ``public`` no hay copia que quitar.

Revision ID: b5e9a2f7c063
Revises: c8f2b6d04a17
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b5e9a2f7c063"
down_revision: Union[str, None] = "c8f2b6d04a17"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    schema = bind.execute(sa.text("SELECT current_schema()")).scalar_one()
    if schema == "public":
        return
    local = bind.execute(
        sa.text("SELECT to_regprocedure(format('%I.f_unaccent(text)', current_schema()))::oid")
    ).scalar_one()
    shared = bind.execute(sa.text("SELECT to_regprocedure('public.f_unaccent(text)')::oid")).scalar_one()
    if local is None or shared is None:
        # Sin la de public, quitar la local dejaría la búsqueda sin función.
        return
    in_use = bind.execute(
        sa.text("SELECT 1 FROM pg_depend WHERE refclassid = 'pg_proc'::regclass AND refobjid = :oid LIMIT 1"),
        {"oid": local},
    ).first()
    if in_use is not None:
        return
    # El nombre del schema lo cita PostgreSQL, no este archivo.
    drop = bind.execute(
        sa.text("SELECT format('DROP FUNCTION %I.f_unaccent(text)', current_schema())")
    ).scalar_one()
    bind.exec_driver_sql(drop)


def downgrade() -> None:
    # No se recrea la copia: volvería a dejar los índices sin uso.
    pass
