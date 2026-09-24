"""Identidad de WhatsApp con los valores exactos de Meta.

Revision ID: a1d4e6f8b203
Revises: f3a8c2d7e915

``whatsapp_identities`` guardaba JID sintéticos: el teléfono con un sufijo de
servidor y el identificador de usuario con otro. Meta no manda ninguno de los
dos; manda ``wa_id`` (el teléfono) y ``user_id`` (el identificador de usuario
por negocio). La tabla pasa a ``(phone_number_id, identifier, kind)`` con
``kind`` en ``wa_id``/``user_id``.

La conversión se hace solo con evidencia:

- un alias telefónico se convierte a su ``wa_id``: son los mismos dígitos;
- un alias de usuario se convierte solo si algún mensaje de Meta guardado trae
  ese ``from_user_id``; se toma el valor tal como lo mandó Meta (el alias se
  guardaba en minúsculas y el identificador distingue mayúsculas);
- el resto (identificadores internos de la integración anterior, que Meta no
  reconoce) y los duplicados que produzca la conversión se copian a
  ``archived_whatsapp_identities`` antes de borrarse.

``leads.remote_jid`` era un puente para integraciones viejas y deja de existir;
su valor también queda archivado.

No tiene downgrade: los sufijos no se pueden reconstruir sin inventarlos.
Restaurar el respaldo previo a la migración si hace falta volver atrás.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "a1d4e6f8b203"
down_revision: Union[str, None] = "f3a8c2d7e915"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE archived_whatsapp_identities (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            source text NOT NULL,
            source_id text,
            lead_id uuid,
            connection text,
            value text NOT NULL,
            kind text,
            reason text NOT NULL,
            archived_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE archived_whatsapp_identities IS
        'Copia de solo lectura de alias previos a Meta que no se pudieron convertir con evidencia (a1d4e6f8b203).'
        """
    )

    op.execute("ALTER TABLE whatsapp_identities ADD COLUMN phone_number_id text")
    op.execute("ALTER TABLE whatsapp_identities ADD COLUMN identifier text")
    op.execute("ALTER TABLE whatsapp_identities ADD COLUMN meta_kind text")

    # Teléfono: el wa_id son los mismos dígitos que precedían al sufijo.
    op.execute(
        """
        UPDATE whatsapp_identities
        SET identifier = split_part(jid, '@', 1), meta_kind = 'wa_id'
        WHERE kind = 'phone' AND split_part(jid, '@', 1) ~ '^[0-9]+$'
        """
    )
    # Usuario: solo si un mensaje de Meta guardado trae ese from_user_id. Se
    # usa el valor literal del payload, no el alias en minúsculas.
    op.execute(
        """
        WITH evidence AS (
            SELECT DISTINCT payload #>> '{message,from_user_id}' AS user_id
            FROM wsp_messages
            WHERE payload #>> '{message,from_user_id}' IS NOT NULL
            UNION
            SELECT DISTINCT provider_payload ->> 'from_user_id'
            FROM wsp_messages
            WHERE provider_payload ->> 'from_user_id' IS NOT NULL
        )
        UPDATE whatsapp_identities AS alias
        SET identifier = evidence.user_id, meta_kind = 'user_id'
        FROM evidence
        WHERE alias.kind = 'lid'
          AND lower(split_part(alias.jid, '@', 1)) = lower(evidence.user_id)
        """
    )
    op.execute("UPDATE whatsapp_identities SET phone_number_id = instance")

    op.execute(
        """
        INSERT INTO archived_whatsapp_identities (source, source_id, lead_id, connection, value, kind, reason)
        SELECT 'whatsapp_identities', id::text, lead_id, instance, jid, kind, 'sin_evidencia_meta'
        FROM whatsapp_identities
        WHERE identifier IS NULL
        """
    )
    op.execute("DELETE FROM whatsapp_identities WHERE identifier IS NULL")

    # Un alias comodín ('*') y uno de la conexión real con el mismo valor
    # quedan redundantes; dos filas con el mismo valor en la misma conexión
    # (antes diferían solo en mayúsculas) también. Se conserva la más reciente
    # y, si apuntaban a leads distintos, las dos quedan archivadas para
    # resolverlas a mano en vez de mezclar historiales.
    op.execute(
        """
        WITH ranked AS (
            SELECT id, lead_id, identifier, meta_kind, phone_number_id,
                   min(lead_id::text) OVER (PARTITION BY meta_kind, identifier)
                       <> max(lead_id::text) OVER (PARTITION BY meta_kind, identifier) AS shared,
                   row_number() OVER (
                       PARTITION BY meta_kind, identifier
                       ORDER BY (phone_number_id <> '*') DESC, updated_at DESC, id DESC
                   ) AS position
            FROM whatsapp_identities
        ),
        dropped AS (
            SELECT id,
                   CASE WHEN shared THEN 'conflicto_de_leads' ELSE 'duplicado' END AS reason
            FROM ranked
            WHERE position > 1 OR shared
        )
        INSERT INTO archived_whatsapp_identities (source, source_id, lead_id, connection, value, kind, reason)
        SELECT 'whatsapp_identities', alias.id::text, alias.lead_id, alias.instance, alias.jid, alias.kind, dropped.reason
        FROM whatsapp_identities AS alias
        JOIN dropped ON dropped.id = alias.id
        """
    )
    op.execute(
        """
        DELETE FROM whatsapp_identities
        WHERE id IN (
            SELECT source_id::bigint FROM archived_whatsapp_identities
            WHERE source = 'whatsapp_identities' AND reason IN ('duplicado', 'conflicto_de_leads')
        )
        """
    )

    op.execute("DROP INDEX IF EXISTS uq_whatsapp_identities_instance_jid")
    op.execute("ALTER TABLE whatsapp_identities DROP CONSTRAINT IF EXISTS whatsapp_identities_kind_check")
    op.execute("ALTER TABLE whatsapp_identities DROP COLUMN instance")
    op.execute("ALTER TABLE whatsapp_identities DROP COLUMN jid")
    op.execute("ALTER TABLE whatsapp_identities DROP COLUMN kind")
    op.execute("ALTER TABLE whatsapp_identities RENAME COLUMN meta_kind TO kind")
    op.execute("ALTER TABLE whatsapp_identities ALTER COLUMN phone_number_id SET NOT NULL")
    op.execute("ALTER TABLE whatsapp_identities ALTER COLUMN identifier SET NOT NULL")
    op.execute("ALTER TABLE whatsapp_identities ALTER COLUMN kind SET NOT NULL")
    op.execute(
        "ALTER TABLE whatsapp_identities ADD CONSTRAINT whatsapp_identities_kind_check "
        "CHECK (kind IN ('wa_id', 'user_id'))"
    )
    # Un wa_id o un user_id identifica a una sola persona para el negocio,
    # sin importar por cuál de sus números llegó.
    op.execute(
        "CREATE UNIQUE INDEX uq_whatsapp_identities_kind_identifier "
        "ON whatsapp_identities (kind, identifier)"
    )

    op.execute(
        """
        INSERT INTO archived_whatsapp_identities (source, source_id, lead_id, value, reason)
        SELECT 'leads.remote_jid', id::text, id, remote_jid, 'columna_retirada'
        FROM leads
        WHERE remote_jid IS NOT NULL
        """
    )
    # El DROP COLUMN se lleva la restricción UNIQUE (sea constraint o índice).
    op.execute("ALTER TABLE leads DROP CONSTRAINT IF EXISTS uq_leads_remote_jid")
    op.execute("DROP INDEX IF EXISTS uq_leads_remote_jid")
    op.execute("ALTER TABLE leads DROP COLUMN IF EXISTS remote_jid")
    op.execute("DROP FUNCTION IF EXISTS lead_phone_from_jid(text)")


def downgrade() -> None:
    raise NotImplementedError(
        "a1d4e6f8b203 no se revierte: restaurar el respaldo previo a la migración"
    )
