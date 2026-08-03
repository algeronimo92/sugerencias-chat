"""Identificador interno para leads y todas sus relaciones.

Revision ID: 6d1f0a9c3e42
Revises: f4a8c2d91e07

Los JID de WhatsApp dejan de ser la identidad relacional del CRM. Se conserva
``leads.remote_jid`` temporalmente como dato legacy para permitir un despliegue
coordinado con n8n, pero la PK y todas las FK pasan a ``leads.id``.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "6d1f0a9c3e42"
down_revision: Union[str, None] = "f4a8c2d91e07"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


REFERENCES = (
    ("whatsapp_identities", "lead_id", False, "CASCADE"),
    ("wsp_messages", "chat_id", False, "CASCADE"),
    ("message_outbox", "chat_id", False, "CASCADE"),
    ("scheduled_messages", "lead_id", False, "CASCADE"),
    ("lead_tag_assignments", "lead_id", False, "CASCADE"),
    ("lead_activity", "lead_id", False, "CASCADE"),
    ("lead_notes", "lead_id", False, "CASCADE"),
    ("user_notifications", "lead_id", True, "SET NULL"),
    ("lead_tasks", "lead_id", False, "CASCADE"),
    ("automation_executions", "lead_id", True, "SET NULL"),
)


INDEXES = (
    "CREATE INDEX idx_whatsapp_identities_lead ON whatsapp_identities (lead_id)",
    "CREATE INDEX idx_wsp_messages_chat_cursor ON wsp_messages (chat_id, sent_at DESC, id DESC)",
    "CREATE INDEX idx_message_outbox_chat_order ON message_outbox (chat_id, id)",
    "CREATE INDEX idx_scheduled_messages_lead ON scheduled_messages (lead_id, scheduled_at DESC)",
    "CREATE INDEX idx_lead_tag_assignments_tag_lead ON lead_tag_assignments (tag_id, lead_id)",
    "CREATE INDEX idx_lead_activity_lead_created ON lead_activity (lead_id, created_at DESC)",
    "CREATE INDEX idx_lead_notes_lead_created ON lead_notes (lead_id, created_at, id)",
    "CREATE INDEX idx_user_notifications_lead ON user_notifications (lead_id)",
    "CREATE INDEX idx_lead_tasks_lead_status_due ON lead_tasks (lead_id, status, due_at)",
    "CREATE INDEX idx_automation_executions_lead_created ON automation_executions (lead_id, created_at DESC)",
)


def _drop_lead_fk(table: str) -> None:
    op.execute(
        f"""
        DO $$
        DECLARE constraint_name text;
        BEGIN
          FOR constraint_name IN
            SELECT con.conname
            FROM pg_constraint con
            WHERE con.contype = 'f'
              AND con.conrelid = '{table}'::regclass
              AND con.confrelid = 'leads'::regclass
          LOOP
            EXECUTE format('ALTER TABLE {table} DROP CONSTRAINT %I', constraint_name);
          END LOOP;
        END $$;
        """
    )


def _migrate_reference(table: str, column: str, nullable: bool) -> None:
    _drop_lead_fk(table)
    if table == "lead_tag_assignments":
        op.execute("ALTER TABLE lead_tag_assignments DROP CONSTRAINT IF EXISTS lead_tag_assignments_pkey")
    op.execute(f"ALTER TABLE {table} RENAME COLUMN {column} TO {column}_legacy")
    op.execute(f"ALTER TABLE {table} ADD COLUMN {column} UUID")
    op.execute(
        f"""
        UPDATE {table} child
        SET {column} = lead.id
        FROM leads lead
        WHERE child.{column}_legacy = lead.remote_jid
        """
    )
    if not nullable:
        op.execute(f"ALTER TABLE {table} ALTER COLUMN {column} SET NOT NULL")
    op.execute(f"ALTER TABLE {table} DROP COLUMN {column}_legacy")


def upgrade() -> None:
    # PostgreSQL 16 incluye gen_random_uuid() sin requerir una extensión.
    op.execute(
        "ALTER TABLE leads ADD COLUMN id UUID DEFAULT gen_random_uuid()"
    )
    op.execute("ALTER TABLE leads ALTER COLUMN id SET NOT NULL")

    # Todo lead histórico obtiene al menos un alias portable. El comodín se
    # consulta como fallback y el primer webhook real agrega el alias con la
    # instancia concreta sin perder la asociación.
    op.execute(
        """
        INSERT INTO whatsapp_identities (instance, jid, kind, lead_id)
        SELECT '*', remote_jid,
               CASE WHEN remote_jid LIKE '%@lid' THEN 'lid' ELSE 'phone' END,
               remote_jid
        FROM leads
        WHERE remote_jid IS NOT NULL
          AND remote_jid ~ '^[0-9]+@(s\\.whatsapp\\.net|lid)$'
        ON CONFLICT (instance, jid) DO NOTHING
        """
    )

    for table, column, nullable, _ondelete in REFERENCES:
        _migrate_reference(table, column, nullable)

    op.execute("ALTER TABLE leads DROP CONSTRAINT leads_pkey")
    op.execute("ALTER TABLE leads ADD CONSTRAINT leads_pkey PRIMARY KEY (id)")
    op.execute("ALTER TABLE leads ALTER COLUMN remote_jid DROP NOT NULL")
    op.execute("ALTER TABLE leads ADD CONSTRAINT uq_leads_remote_jid UNIQUE (remote_jid)")

    for table, column, _nullable, ondelete in REFERENCES:
        op.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT {table}_{column}_fkey "
            f"FOREIGN KEY ({column}) REFERENCES leads(id) ON DELETE {ondelete}"
        )

    op.execute(
        "ALTER TABLE lead_tag_assignments ADD CONSTRAINT lead_tag_assignments_pkey PRIMARY KEY (lead_id, tag_id)"
    )
    for statement in INDEXES:
        op.execute(statement)


def downgrade() -> None:
    # Un downgrade solo es seguro mientras todos los leads con relaciones
    # conserven remote_jid; la aplicación lo mantiene durante esta transición.
    op.execute(
        """
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM leads WHERE remote_jid IS NULL) THEN
            RAISE EXCEPTION 'No se puede volver a remote_jid: existen leads sin JID legacy';
          END IF;
        END $$;
        """
    )
    for table, column, _nullable, _ondelete in REFERENCES:
        _drop_lead_fk(table)
    op.execute("ALTER TABLE lead_tag_assignments DROP CONSTRAINT lead_tag_assignments_pkey")

    for table, column, nullable, _ondelete in REFERENCES:
        op.execute(f"ALTER TABLE {table} RENAME COLUMN {column} TO {column}_internal")
        op.execute(f"ALTER TABLE {table} ADD COLUMN {column} TEXT")
        op.execute(
            f"""
            UPDATE {table} child
            SET {column} = lead.remote_jid
            FROM leads lead
            WHERE child.{column}_internal = lead.id
            """
        )
        if not nullable:
            op.execute(f"ALTER TABLE {table} ALTER COLUMN {column} SET NOT NULL")
        op.execute(f"ALTER TABLE {table} DROP COLUMN {column}_internal")

    op.execute("ALTER TABLE leads DROP CONSTRAINT leads_pkey")
    op.execute("ALTER TABLE leads DROP CONSTRAINT uq_leads_remote_jid")
    op.execute("ALTER TABLE leads ALTER COLUMN remote_jid SET NOT NULL")
    op.execute("ALTER TABLE leads ADD CONSTRAINT leads_pkey PRIMARY KEY (remote_jid)")

    for table, column, _nullable, ondelete in REFERENCES:
        op.execute(
            f"ALTER TABLE {table} ADD CONSTRAINT {table}_{column}_fkey "
            f"FOREIGN KEY ({column}) REFERENCES leads(remote_jid) ON DELETE {ondelete}"
        )
    op.execute(
        "ALTER TABLE lead_tag_assignments ADD CONSTRAINT lead_tag_assignments_pkey PRIMARY KEY (lead_id, tag_id)"
    )
    for statement in INDEXES:
        op.execute(statement)
    op.execute("ALTER TABLE leads DROP COLUMN id")
