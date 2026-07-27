"""deriva aplicada a mano en produccion

Revision ID: a5b229ee1c70
Revises: b7a2c9d41e08
Create Date: 2026-07-27

Produccion se edito a mano por SQL directo y el esquema del repositorio se
quedo atras. Mientras la base siga viva no se nota; el dia que arranque una
instalacion desde cero (un servidor nuevo, un restore, el otro color de un
blue-green) nacera distinta de la que esta en servicio.

Lo que hay aqui NO se dedujo de memoria: se levanto una base limpia, se le
aplicaron todas las migraciones y se comparo su `pg_dump --schema-only` contra
el de produccion. Esta revision es exactamente ese diff, en el sentido
repositorio -> produccion. Son cuatro cosas:

1. Siete indices sobre columnas de FK que venian de los .sql historicos
   (migrations/001-022) y que la baseline no reprodujo: no estan declarados en
   models.py, asi que autogenerate no los vio.

2. `idx_wsp_messages_wa_message_id` es UNIQUE en produccion y no en el
   repositorio. Es la restriccion que impide duplicar un mensaje entrante
   cuando Evolution API reenvia el mismo webhook: sin ella el reintento se
   inserta otra vez y el mensaje aparece dos veces en el chat.

3. La FK `wsp_messages.chat_id -> leads.remote_jid ON DELETE CASCADE`. Las
   demas tablas que cuelgan de `leads` ya la tenian; esta faltaba, y sin ella
   borrar un lead dejaba su historial de mensajes huerfano.

4. `n8n_chat_histories.session_id` es TEXT en produccion y la revision
   anterior lo reconstruyo como VARCHAR(255). Aquella advertia de que los
   tipos estaban reconstruidos y habia que verificarlos; verificado.

Todo es idempotente: sobre produccion, que ya tiene las cuatro cosas, esta
migracion no hace nada.
"""

from typing import Sequence, Union

from alembic import op

revision: str = "a5b229ee1c70"
down_revision: Union[str, None] = "b7a2c9d41e08"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Indices de columnas de FK que existen en produccion y no en una instalacion
# nueva. Se listan aqui para poder recorrerlos en los dos sentidos.
FK_INDEXES = (
    ("idx_automation_rules_created_by", "automation_rules", "created_by_user_id"),
    ("idx_lead_notes_author", "lead_notes", "author_user_id"),
    ("idx_lead_tasks_completed_by", "lead_tasks", "completed_by_user_id"),
    ("idx_lead_tasks_created_by", "lead_tasks", "created_by_user_id"),
    ("idx_media_assets_uploaded_by", "media_assets", "uploaded_by_user_id"),
    ("idx_scheduled_messages_created_by", "scheduled_messages", "created_by_user_id"),
    ("idx_template_user_state_template", "template_user_state", "template_id"),
)


def upgrade() -> None:
    for name, table, column in FK_INDEXES:
        op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table}({column})")

    # El indice se llama igual en los dos lados, solo cambia si es UNIQUE, asi
    # que un CREATE ... IF NOT EXISTS no lo corregiria: hay que recrearlo. Se
    # mira antes si ya es unico para no dejar la tabla sin indice ni un
    # instante en produccion, que es donde hay trafico.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_index i
                JOIN pg_class c ON c.oid = i.indexrelid
                WHERE c.relname = 'idx_wsp_messages_wa_message_id'
                  AND i.indisunique
            ) THEN
                DROP INDEX IF EXISTS idx_wsp_messages_wa_message_id;
                CREATE UNIQUE INDEX idx_wsp_messages_wa_message_id
                    ON wsp_messages(wa_message_id)
                    WHERE wa_message_id IS NOT NULL;
            END IF;
        END
        $$
        """
    )

    # PostgreSQL no tiene ADD CONSTRAINT IF NOT EXISTS, de ahi el DO.
    #
    # Si la base tuviera filas de `wsp_messages` cuyo `chat_id` no existe en
    # `leads`, el ALTER falla y el arranque se detiene (scripts/migrate.py no
    # continua con una migracion a medias). Es deliberado: esas filas son
    # mensajes sin conversacion a la que pertenecer, y decidir si se borran o
    # se reasignan no es algo que deba hacer una migracion en silencio.
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'wsp_messages_chat_id_fkey'
                  AND conrelid = 'wsp_messages'::regclass
            ) THEN
                ALTER TABLE wsp_messages
                    ADD CONSTRAINT wsp_messages_chat_id_fkey
                    FOREIGN KEY (chat_id) REFERENCES leads(remote_jid)
                    ON DELETE CASCADE;
            END IF;
        END
        $$
        """
    )

    # No-op donde ya es TEXT. VARCHAR(255) -> TEXT no reescribe la tabla.
    op.execute("ALTER TABLE n8n_chat_histories ALTER COLUMN session_id TYPE TEXT")


def downgrade() -> None:
    # Los indices y el tipo de `session_id` no se revierten a proposito: son
    # objetos que produccion ya tenia antes de esta revision, y deshacerlos
    # dejaria la base peor de como estaba. Un downgrade solo debe retirar lo
    # que esta revision introduce de verdad en la base en servicio.
    op.execute(
        "ALTER TABLE wsp_messages DROP CONSTRAINT IF EXISTS wsp_messages_chat_id_fkey"
    )
    op.execute("DROP INDEX IF EXISTS idx_wsp_messages_wa_message_id")
    op.execute(
        "CREATE INDEX idx_wsp_messages_wa_message_id "
        "ON wsp_messages(wa_message_id) WHERE wa_message_id IS NOT NULL"
    )
