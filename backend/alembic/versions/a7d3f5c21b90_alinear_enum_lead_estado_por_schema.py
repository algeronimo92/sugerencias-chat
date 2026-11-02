"""alinear el enum lead_estado con el schema de cada tenant

Revision ID: a7d3f5c21b90
Revises: f1c8e40a5d92

En un schema de tenant convivían dos definiciones del enum: la columna
``leads.estado`` quedó ligada a ``public.lead_estado`` (el baseline crea la
tabla con el tipo sin calificar, y al aprovisionar el schema SQLAlchemy
encontró el tipo ya existente en public y no creó uno local), mientras que el
propio schema sí tenía un ``lead_estado`` propio -- resto de la época en que
el arranque hacía ``create_all``.

Para PostgreSQL dos enums con el mismo nombre en schemas distintos son tipos
incompatibles. Como la aplicación consulta con ``search_path = "<tenant>,
public"``, el parámetro de un INSERT se castea contra el tipo del tenant y la
columna espera el de public:

    column "estado" is of type public.lead_estado but expression is of type
    lead_estado

El resultado era un 500 en ``/api/webhooks/ensure-lead`` con cada mensaje
entrante de ese negocio: ningún lead nuevo llegaba al CRM.

La reparación liga la columna al enum de su propio schema, que es como ya
quedaban los schemas aprovisionados correctamente: así cada tenant es
autocontenido (un ``pg_dump -n <schema>`` se restaura solo) y deja de depender
de que el tipo siga existiendo en public. Es idempotente y no hace nada donde
el schema no tiene un ``lead_estado`` propio o donde tipo y columna ya
coinciden, incluido ``public``.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "a7d3f5c21b90"
down_revision: Union[str, None] = "f1c8e40a5d92"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# current_schema() es el primer schema del search_path: el del tenant cuando
# env.py lo fija al aprovisionar, y public en la ejecución normal.
_ALIGN_ENUM = """
DO $$
DECLARE
    target_schema text := current_schema();
    column_type_schema text;
    local_type_oid oid;
BEGIN
    SELECT tn.nspname
      INTO column_type_schema
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid
      JOIN pg_namespace tn ON tn.oid = t.typnamespace
     WHERE n.nspname = target_schema
       AND c.relname = 'leads'
       AND a.attname = 'estado'
       AND NOT a.attisdropped;

    -- Un schema sin tabla `leads` propia (la ve por search_path) no tiene
    -- nada que alinear.
    IF column_type_schema IS NULL THEN
        RETURN;
    END IF;

    SELECT t.oid
      INTO local_type_oid
      FROM pg_type t
      JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = target_schema
       AND t.typname = 'lead_estado';

    IF local_type_oid IS NULL OR column_type_schema = target_schema THEN
        RETURN;
    END IF;

    -- El default guarda el tipo viejo; hay que soltarlo antes de convertir.
    EXECUTE format(
        'ALTER TABLE %I.leads ALTER COLUMN estado DROP DEFAULT', target_schema
    );
    EXECUTE format(
        'ALTER TABLE %I.leads ALTER COLUMN estado TYPE %I.lead_estado '
        'USING estado::text::%I.lead_estado',
        target_schema, target_schema, target_schema
    );
    EXECUTE format(
        'ALTER TABLE %I.leads ALTER COLUMN estado '
        'SET DEFAULT ''nuevo''::%I.lead_estado',
        target_schema, target_schema
    );
END $$;
"""


def upgrade() -> None:
    op.execute(_ALIGN_ENUM)


def downgrade() -> None:
    # Recrear el duplicado sería restaurar el estado roto a propósito. El
    # esquema alineado es válido para cualquier revisión anterior.
    pass
