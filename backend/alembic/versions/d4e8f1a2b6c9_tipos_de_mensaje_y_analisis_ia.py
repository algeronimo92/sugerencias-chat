"""tipos de mensaje y analisis ia estructurado

Revision ID: d4e8f1a2b6c9
Revises: c3f1d7a95b42
Create Date: 2026-07-28

Hasta ahora `wsp_messages.content` multiplexaba en un solo TEXT tres cosas:
el tipo (pseudo-tags `<image>...</image>` que arma n8n), el caption humano, y
—en imagen/audio/video— el analisis que genera la IA (`Analisis: ...`). Eso
hacia que el analisis se le mostrara al vendedor dentro de la burbuja, y que
tipos ricos de WhatsApp (sticker, documento, contacto, encuesta, reaccion,
listas/botones, plantilla) no tuvieran donde vivir y cayeran a `<other>`.

Esta migracion normaliza el modelo con tres columnas:
  - message_type: discriminador con la taxonomia completa (concordancia con
    docs/evolution-api-2.3-mensajes/). El CHECK la fija.
  - analysis: enriquecimiento IA estructurado, para poder mostrarlo aparte y
    regenerarlo sin pisar el caption.
  - payload: datos propios del tipo (lat/lon, filename, opciones de encuesta...).

`content` pasa a contener solo texto humano. La migracion es ADITIVA: las tres
columnas nacen NULL y el CHECK las acepta (NULL pasa el IN). El backfill de las
filas viejas va aparte, con dump previo.

`wsp_messages` esta en EXTERNAL_TABLES (ver alembic/env.py), asi que autogenerate
no la mira: el DDL va a mano y con IF NOT EXISTS para ser idempotente.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "d4e8f1a2b6c9"
down_revision: Union[str, None] = "c3f1d7a95b42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Fuente de verdad de la taxonomia, tambien reflejada en models.py (WspMessage)
# y en el frontend (utils/message.ts).
MESSAGE_TYPES = (
    "text",
    "image",
    "video",
    "ptv",
    "audio",
    "document",
    "location",
    "sticker",
    "contact",
    "poll",
    "reaction",
    "interactive",
    "template",
    "unsupported",
)


def upgrade() -> None:
    op.execute("ALTER TABLE wsp_messages ADD COLUMN IF NOT EXISTS message_type TEXT")
    op.execute("ALTER TABLE wsp_messages ADD COLUMN IF NOT EXISTS analysis JSONB")
    op.execute("ALTER TABLE wsp_messages ADD COLUMN IF NOT EXISTS payload JSONB")

    # ADD CONSTRAINT no admite IF NOT EXISTS; el DO lo hace idempotente.
    allowed = ", ".join(f"'{t}'" for t in MESSAGE_TYPES)
    op.execute(
        f"""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'wsp_messages_message_type_check'
            ) THEN
                ALTER TABLE wsp_messages
                    ADD CONSTRAINT wsp_messages_message_type_check
                    CHECK (message_type IS NULL OR message_type IN ({allowed}));
            END IF;
        END $$;
        """
    )

    # Busqueda: mismo patron que idx_wsp_messages_content_trgm (GIN trigram sobre
    # f_unaccent), para poder encontrar media por el texto de su analisis sin
    # recorrido completo. f_unaccent ya existe y es IMMUTABLE (la usa el otro
    # indice). El operador ->> devuelve NULL cuando no hay analisis: no se indexa.
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_wsp_messages_analysis_trgm "
        "ON wsp_messages USING gin (f_unaccent(analysis->>'summary') gin_trgm_ops)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS idx_wsp_messages_analysis_trgm")
    op.execute(
        "ALTER TABLE wsp_messages DROP CONSTRAINT IF EXISTS wsp_messages_message_type_check"
    )
    op.execute("ALTER TABLE wsp_messages DROP COLUMN IF EXISTS payload")
    op.execute("ALTER TABLE wsp_messages DROP COLUMN IF EXISTS analysis")
    op.execute("ALTER TABLE wsp_messages DROP COLUMN IF EXISTS message_type")
