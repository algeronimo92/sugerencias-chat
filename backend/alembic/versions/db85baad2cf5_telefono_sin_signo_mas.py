"""leads.telefono deja de llevar el '+' inicial: pasa a ser solo digitos
E.164 (ej. "51987654321" en vez de "+51987654321"), consistente con
remote_jid y con services/phone_utils.normalize_phone, que ya trabajan sin
'+'. La fuente de verdad real del formato es la funcion lead_phone_from_jid
definida en 028_lead_telefono_consistency_triggers.sql (trigger BEFORE
INSERT OR UPDATE ON leads): sin tocarla, cualquier cambio en Python queda
pisado en la siguiente escritura.

Revision ID: db85baad2cf5
Revises: f32cf61128a0
Create Date: 2026-08-29 00:00:00.000000
"""

from typing import Sequence, Union

from alembic import op


revision: str = 'db85baad2cf5'
down_revision: Union[str, None] = 'f32cf61128a0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        r"""
        CREATE OR REPLACE FUNCTION lead_phone_from_jid(jid text)
        RETURNS text
        LANGUAGE sql
        IMMUTABLE
        AS $$
            SELECT CASE
                WHEN jid ~ '^[0-9]+@s\.whatsapp\.net$' THEN split_part(jid, '@', 1)
                ELSE NULL
            END;
        $$;
        """
    )
    op.execute("UPDATE leads SET telefono = regexp_replace(telefono, '^\\+', '') WHERE telefono LIKE '+%'")


def downgrade() -> None:
    op.execute(
        r"""
        CREATE OR REPLACE FUNCTION lead_phone_from_jid(jid text)
        RETURNS text
        LANGUAGE sql
        IMMUTABLE
        AS $$
            SELECT CASE
                WHEN jid ~ '^[0-9]+@s\.whatsapp\.net$' THEN '+' || split_part(jid, '@', 1)
                ELSE NULL
            END;
        $$;
        """
    )
    op.execute("UPDATE leads SET telefono = '+' || telefono WHERE telefono IS NOT NULL AND telefono NOT LIKE '+%'")
