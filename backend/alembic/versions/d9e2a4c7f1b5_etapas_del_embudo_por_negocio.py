"""Etapas del embudo configurables por negocio.

Revision ID: d9e2a4c7f1b5
Revises: c5d2e8f1a7b3

Hasta ahora las 13 etapas del embudo eran un enum de PostgreSQL
(``lead_estado``) idéntico para todos los negocios. Cada negocio necesita
renombrarlas, reordenarlas, colorearlas, desactivarlas y crear las suyas, así
que pasan a ser filas de ``lead_stages`` en el schema del tenant:

- ``key`` es la clave estable (``perdido``, ``en_diagnostico``...). No cambia
  al renombrar: es lo que guardan ``leads.estado``, las automatizaciones, las
  plantillas y el historial de ``lead_activity``, y lo que devuelve el
  analista de n8n. Por eso las 13 etapas se siembran con sus claves de
  siempre: los datos, las reglas guardadas y el workflow siguen siendo válidos
  sin reescribir nada.
- ``kind`` (``open`` / ``won`` / ``lost``) es la semántica que el código usa
  en vez de mirar el nombre: una etapa ``lost`` pide y guarda la razón de
  pérdida, sea ``perdido`` o una propia del negocio.
- ``description`` es el criterio del negocio para usar la etapa; el analista
  IA lo recibe junto con la lista para decidir entre etapas que no conoce.

``leads.estado`` pasa de enum a ``text`` con una FK a ``lead_stages(key)``: la
base garantiza que la clave exista (y que no se borre una etapa con leads);
que esté activa lo valida la aplicación al mover un lead.

Plano tenant: corre en cada schema y en public mientras conviva el negocio
legacy. ``leads`` está fuera de autogenerate (EXTERNAL_TABLES), así que el
cambio de la columna se escribe a mano.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d9e2a4c7f1b5"
down_revision: Union[str, None] = "c5d2e8f1a7b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_LEAD_STAGE_VALUES = (
    "nuevo", "en_diagnostico", "calificado", "oferta_presentada", "en_objecion",
    "agendado", "cliente_activo", "postventa", "en_seguimiento", "en_nutricion",
    "perdido", "descalificado", "baja",
)

# Mismos nombres, orden y colores que tenía el frontend (leadStageMeta.ts),
# con el hex del tono 500 de Tailwind de cada una.
_SEED = (
    ("nuevo", "Nuevo", "#0ea5e9", "open",
     "Lead recién llegado; todavía no se conversó sobre su necesidad."),
    ("en_diagnostico", "En diagnóstico", "#6366f1", "open",
     "Se está entendiendo qué necesita el cliente."),
    ("calificado", "Calificado", "#06b6d4", "open",
     "Su necesidad encaja con un servicio del negocio y muestra interés real."),
    ("oferta_presentada", "Oferta presentada", "#8b5cf6", "open",
     "Ya recibió una propuesta concreta: servicio y precio."),
    ("en_objecion", "En objeción", "#f59e0b", "open",
     "Puso una objeción a la oferta (precio, tiempo, dudas)."),
    ("agendado", "Agendado", "#3b82f6", "open",
     "Confirmó de forma explícita la reserva de una cita."),
    ("cliente_activo", "Cliente activo", "#22c55e", "won",
     "Compró o está recibiendo el servicio."),
    ("postventa", "Postventa", "#10b981", "won",
     "Ya recibió el servicio; seguimiento posterior a la venta."),
    ("en_seguimiento", "En seguimiento", "#64748b", "open",
     "Pidió retomar la conversación más adelante."),
    ("en_nutricion", "En nutrición", "#d946ef", "open",
     "Sin intención de compra cercana; se lo mantiene informado."),
    ("perdido", "Perdido", "#f43f5e", "lost",
     "Decidió no comprar por una razón concreta (precio, competencia...)."),
    ("descalificado", "Descalificado", "#78716c", "lost",
     "No encaja con el negocio: servicio que no se ofrece, fuera de zona o spam."),
    ("baja", "Baja", "#6b7280", "lost",
     "Pidió expresamente no recibir más mensajes."),
)


# Suelta el enum del schema actual solo si ya nadie lo usa. En public puede
# seguir referenciado por schemas tenant que todavía no migraron (ver
# a7d3f5c21b90: algunos quedaron ligados a public.lead_estado); ahí se
# conserva sin error y queda huérfano, sin efecto.
_DROP_UNUSED_ENUM = """
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = current_schema()
           AND t.typname = 'lead_estado'
    ) THEN
        BEGIN
            EXECUTE format('DROP TYPE %I.lead_estado', current_schema());
        EXCEPTION WHEN dependent_objects_still_exist THEN
            NULL;
        END;
    END IF;
END $$;
"""

_CREATE_ENUM_IF_MISSING = """
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
          FROM pg_type t
          JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = current_schema()
           AND t.typname = 'lead_estado'
    ) THEN
        EXECUTE format(
            'CREATE TYPE %%I.lead_estado AS ENUM (%s)', current_schema()
        );
    END IF;
END $$;
""" % ", ".join(f"''{value}''" for value in _LEAD_STAGE_VALUES)


def upgrade() -> None:
    lead_stages = op.create_table(
        "lead_stages",
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("color", sa.Text(), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("kind", sa.Text(), server_default="open", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("key ~ '^[a-z][a-z0-9_]{0,39}$'", name="lead_stages_key_check"),
        sa.CheckConstraint("color ~ '^#[0-9a-f]{6}$'", name="lead_stages_color_check"),
        sa.CheckConstraint("kind IN ('open', 'won', 'lost')", name="lead_stages_kind_check"),
        # La etapa inicial de todo lead nuevo no puede apagarse: sería dejar
        # entrar leads a una columna que el embudo no muestra.
        sa.CheckConstraint("key <> 'nuevo' OR is_active", name="lead_stages_initial_active_check"),
        sa.PrimaryKeyConstraint("key"),
    )
    op.create_index(
        "uq_lead_stages_name_lower", "lead_stages", [sa.text("lower(name)")], unique=True
    )
    op.bulk_insert(
        lead_stages,
        [
            {
                "key": key,
                "name": name,
                "color": color,
                "position": position,
                "kind": kind,
                "is_active": True,
                "description": description,
            }
            for position, (key, name, color, kind, description) in enumerate(_SEED)
        ],
    )

    # El default guarda el tipo del enum: hay que soltarlo antes de convertir.
    op.execute("ALTER TABLE leads ALTER COLUMN estado DROP DEFAULT")
    op.execute("ALTER TABLE leads ALTER COLUMN estado TYPE text USING estado::text")
    op.execute("ALTER TABLE leads ALTER COLUMN estado SET DEFAULT 'nuevo'")
    # ON UPDATE CASCADE es solo un seguro: la API nunca cambia una clave.
    op.create_foreign_key(
        "leads_estado_fkey", "leads", "lead_stages", ["estado"], ["key"],
        onupdate="CASCADE", ondelete="RESTRICT",
    )
    op.execute(_DROP_UNUSED_ENUM)


def downgrade() -> None:
    op.drop_constraint("leads_estado_fkey", "leads", type_="foreignkey")
    # Las etapas propias del negocio no existen en el enum: sus leads vuelven
    # a la etapa sembrada de la misma semántica antes de convertir.
    op.execute(
        """
        UPDATE leads AS lead
           SET estado = CASE stage.kind
                            WHEN 'lost' THEN 'perdido'
                            WHEN 'won' THEN 'cliente_activo'
                            ELSE 'nuevo'
                        END
          FROM lead_stages AS stage
         WHERE stage.key = lead.estado
           AND stage.key NOT IN ({})
        """.format(", ".join(f"'{value}'" for value in _LEAD_STAGE_VALUES))
    )
    op.execute(_CREATE_ENUM_IF_MISSING)
    op.execute("ALTER TABLE leads ALTER COLUMN estado DROP DEFAULT")
    op.execute(
        "ALTER TABLE leads ALTER COLUMN estado TYPE lead_estado USING estado::lead_estado"
    )
    op.execute("ALTER TABLE leads ALTER COLUMN estado SET DEFAULT 'nuevo'::lead_estado")
    op.drop_index("uq_lead_stages_name_lower", table_name="lead_stages")
    op.drop_table("lead_stages")
