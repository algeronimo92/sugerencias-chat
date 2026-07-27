"""objetos que n8n necesita para escribir

Revision ID: b7a2c9d41e08
Revises: eca1f1c0b41a
Create Date: 2026-07-26

Hasta ahora la base era externa y compartida: n8n mantenia por su cuenta unas
columnas y una tabla que este proyecto no declara. Al pasar PostgreSQL al
compose, una instalacion nueva nace sin ellas, y entonces n8n falla al insertar
un mensaje entrante. El sintoma seria el peor posible: la aplicacion arranca
sana, el chat funciona, y simplemente dejan de llegar WhatsApps.

Los nombres salen del analisis de deriva que se hizo contra la base de
produccion (comparando information_schema con models.py). Los TIPOS estan
reconstruidos, no volcados: el esquema original ya no existe. Verificar contra
el workflow de n8n antes de darlo por bueno; si alguno no coincide, corregirlo
aqui y aplicar de nuevo.

Todo va con IF NOT EXISTS: sobre una base que ya los tenga, esta migracion no
hace nada.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "b7a2c9d41e08"
down_revision: Union[str, None] = "eca1f1c0b41a"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Columnas de `leads` que escribe el flujo de n8n. La aplicacion no las
    # lee: models.py no las declara y el filtro de env.py las mantiene fuera de
    # autogenerate, para que un `--autogenerate` no proponga borrarlas.
    op.execute("ALTER TABLE leads ADD COLUMN IF NOT EXISTS metadata JSONB")
    op.execute("ALTER TABLE leads ADD COLUMN IF NOT EXISTS tipo_objecion TEXT")
    op.execute("ALTER TABLE leads ADD COLUMN IF NOT EXISTS ultimo_emisor TEXT")
    op.execute("ALTER TABLE leads ADD COLUMN IF NOT EXISTS ultimo_mensaje_at TIMESTAMPTZ")

    # `created_at` de wsp_messages: la aplicacion ordena por `sent_at`, pero
    # n8n rellena este otro al insertar.
    op.execute("ALTER TABLE wsp_messages ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now()")

    # Memoria de conversacion del agente de n8n. Es el esquema que crea su
    # nodo de Postgres Chat Memory.
    op.execute(
        """
        CREATE TABLE IF NOT EXISTS n8n_chat_histories (
            id         SERIAL PRIMARY KEY,
            session_id VARCHAR(255) NOT NULL,
            message    JSONB NOT NULL
        )
        """
    )
    op.execute(
        "CREATE INDEX IF NOT EXISTS idx_n8n_chat_histories_session "
        "ON n8n_chat_histories(session_id)"
    )

    # Indices que existian en produccion sobre las tablas compartidas. Sin
    # ellos las consultas de n8n hacen recorrido completo, que con el historial
    # crecido se nota enseguida.
    for statement in (
        "CREATE INDEX IF NOT EXISTS idx_leads_estado ON leads(estado)",
        "CREATE INDEX IF NOT EXISTS idx_leads_fecha_recontacto ON leads(fecha_recontacto)",
        "CREATE INDEX IF NOT EXISTS idx_leads_proxima_cita ON leads(proxima_cita)",
        "CREATE INDEX IF NOT EXISTS idx_leads_ultimo_mensaje_at ON leads(ultimo_mensaje_at)",
        "CREATE INDEX IF NOT EXISTS idx_leads_vendedor ON leads(vendedor)",
        "CREATE INDEX IF NOT EXISTS idx_wsp_messages_chat_id ON wsp_messages(chat_id)",
    ):
        op.execute(statement)


def downgrade() -> None:
    # A proposito no se borran las columnas ni la tabla: contendrian datos de
    # n8n y un downgrade automatico los destruiria. Solo se retiran los
    # indices, que se pueden recrear sin perder nada.
    for name in (
        "idx_leads_estado",
        "idx_leads_fecha_recontacto",
        "idx_leads_proxima_cita",
        "idx_leads_ultimo_mensaje_at",
        "idx_leads_vendedor",
        "idx_wsp_messages_chat_id",
        "idx_n8n_chat_histories_session",
    ):
        op.execute(f"DROP INDEX IF EXISTS {name}")
