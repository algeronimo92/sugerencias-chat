"""Backfill auditado al contrato Meta y retiro del modelo anterior.

Revision ID: c7e2f9a4d1b8
Revises: a1d4e6f8b203

Solo usa evidencia guardada:

- Un mensaje con el objeto de Meta en ``payload.message`` (lo guardaba el
  workflow anterior de n8n) pasa ese objeto a ``provider_payload`` y toma de
  ahí su tipo y subtipo literales. Así ``contact`` pasa a ``contacts``, un
  ``unsupported`` recupera su tipo real y un ``button`` queda como ``button``
  solo si Meta lo mandó así (una respuesta a un interactivo queda como
  ``interactive/button_reply``).
- Las filas sin esa evidencia conservan lo que tienen: no se inventa una
  representación de Meta. Las de tipos que el contrato no conoce se copian
  primero a ``archived_wsp_messages``.
- ``status`` mezclaba la cola propia con lo que informaba WhatsApp y usaba
  nombres de la integración anterior. Se separa: la cola va a
  ``outbox_status`` y el estado de entrega, con el literal de Meta, a
  ``meta_status``.
- ``payload`` queda solo como proyección para la UI: la ubicación y los datos
  de plantilla que guardaba el CRM se reordenan bajo su clave.

Al final se retiran ``status`` y ``message_secret`` (copiado antes al archivo).
No tiene downgrade: restaurar el respaldo previo.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "c7e2f9a4d1b8"
down_revision: Union[str, None] = "a1d4e6f8b203"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INBOUND_ROOTS = (
    "text", "image", "video", "audio", "document", "sticker", "location",
    "contacts", "reaction", "interactive", "button", "order", "system",
    "unknown", "unsupported",
)
OUTBOUND_ROOTS = (
    "text", "image", "video", "audio", "document", "sticker", "location",
    "contacts", "reaction", "interactive", "template",
)


def _sql_list(values: tuple[str, ...]) -> str:
    return ", ".join(f"'{value}'" for value in values)


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE archived_wsp_messages (
            id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
            message_id bigint NOT NULL,
            chat_id uuid,
            reason text NOT NULL,
            snapshot jsonb NOT NULL,
            archived_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    op.execute(
        """
        COMMENT ON TABLE archived_wsp_messages IS
        'Copia de solo lectura de mensajes previos al contrato Meta que no se pudieron reconstruir con evidencia (c7e2f9a4d1b8).'
        """
    )
    # La copia incluye el estado y el secreto que se retiran al final.
    snapshot = (
        "to_jsonb(m) - 'message_secret' "
        "|| jsonb_build_object('message_secret', encode(m.message_secret, 'base64'))"
    )

    # 1. Mensajes con el objeto de Meta guardado por el workflow anterior.
    op.execute(
        """
        UPDATE wsp_messages
        SET provider_payload = payload -> 'message',
            message_type = payload #>> '{message,type}',
            message_subtype = CASE payload #>> '{message,type}'
                WHEN 'interactive' THEN payload #>> '{message,interactive,type}'
                WHEN 'system' THEN payload #>> '{message,system,type}'
            END,
            payload = NULLIF(payload - 'message' - 'referral' - 'contacts', '{}'::jsonb)
        WHERE provider_payload IS NULL
          AND jsonb_typeof(payload -> 'message') = 'object'
          AND payload #>> '{message,id}' IS NOT NULL
          AND payload #>> '{message,type}' IS NOT NULL
        """
    )

    # 2. Tipos fuera del contrato y sin evidencia: se archivan y se dejan.
    op.execute(
        f"""
        INSERT INTO archived_wsp_messages (message_id, chat_id, reason, snapshot)
        SELECT m.id, m.chat_id, 'tipo_sin_evidencia_meta', {snapshot}
        FROM wsp_messages AS m
        WHERE m.provider_payload IS NULL
          AND m.message_type IS NOT NULL
          AND m.message_type NOT IN ({_sql_list(tuple(sorted(set(INBOUND_ROOTS) | set(OUTBOUND_ROOTS))))})
        """
    )
    # Filas sin tipo (anteriores a la columna) y filas con secreto de edición
    # también quedan copiadas: el secreto desaparece al final.
    op.execute(
        f"""
        INSERT INTO archived_wsp_messages (message_id, chat_id, reason, snapshot)
        SELECT m.id, m.chat_id,
               CASE WHEN m.message_type IS NULL THEN 'sin_tipo' ELSE 'secreto_de_edicion' END,
               {snapshot}
        FROM wsp_messages AS m
        WHERE (m.message_type IS NULL OR m.message_secret IS NOT NULL)
          AND NOT EXISTS (SELECT 1 FROM archived_wsp_messages AS a WHERE a.message_id = m.id)
        """
    )

    # 3. Proyecciones del CRM reordenadas bajo la clave de su raíz.
    op.execute(
        """
        UPDATE wsp_messages
        SET payload = jsonb_build_object('location', jsonb_strip_nulls(jsonb_build_object(
                'latitude', payload -> 'latitude',
                'longitude', payload -> 'longitude',
                'name', payload -> 'name',
                'address', payload -> 'address'
            ))) || (payload - 'latitude' - 'longitude' - 'name' - 'address')
        WHERE provider_payload IS NULL
          AND message_type = 'location'
          AND payload ? 'latitude' AND payload ? 'longitude'
        """
    )
    op.execute(
        """
        UPDATE wsp_messages
        SET payload = jsonb_build_object('template', jsonb_build_object(
                'name', payload -> 'name',
                'language', payload -> 'language',
                'header_text', payload -> 'header_text',
                'header_image_url', payload -> 'header_image_url',
                'footer', payload -> 'footer',
                'buttons', COALESCE(payload -> 'buttons', '[]'::jsonb)
            )) || CASE WHEN payload ? 'forwarded' THEN jsonb_build_object('forwarded', payload -> 'forwarded') ELSE '{}'::jsonb END
        WHERE message_type = 'template'
          AND payload ->> 'type' = 'official_template'
        """
    )

    # 4. Estado: la cola propia y el de WhatsApp, por separado. Los nombres
    #    viejos de entrega se vuelven a los literales que Meta había mandado.
    op.execute(
        """
        UPDATE wsp_messages
        SET outbox_status = CASE status
                WHEN 'PENDING' THEN 'queued'
                WHEN 'FAILED' THEN 'failed'
                WHEN 'DISCARDED' THEN 'discarded'
                WHEN 'SERVER_ACK' THEN 'sent'
                WHEN 'DELIVERY_ACK' THEN 'sent'
                WHEN 'READ' THEN 'sent'
                WHEN 'PLAYED' THEN 'sent'
                WHEN 'REJECTED' THEN 'sent'
            END,
            meta_status = CASE status
                WHEN 'SERVER_ACK' THEN 'sent'
                WHEN 'DELIVERY_ACK' THEN 'delivered'
                WHEN 'READ' THEN 'read'
                WHEN 'PLAYED' THEN 'read'
                WHEN 'REJECTED' THEN 'failed'
            END
        WHERE status IS NOT NULL AND sender = 'vendedor'
        """
    )
    # Un mensaje del cliente no tiene cola ni entrega propia: su READ era el
    # recibo de lectura de un dispositivo vinculado, que Meta no informa.
    op.execute(
        """
        UPDATE wsp_messages
        SET outbox_status = 'sent'
        WHERE sender = 'vendedor' AND outbox_status IS NULL
          AND EXISTS (SELECT 1 FROM message_outbox AS o WHERE o.message_id = wsp_messages.id AND o.status = 'sent')
        """
    )

    # 5. Trabajos viejos del outbox que no llegaron a salir: el worker nuevo
    #    solo envía cuerpos de Meta, así que se cierran como descartados.
    op.execute(
        """
        UPDATE wsp_messages
        SET outbox_status = 'discarded'
        WHERE id IN (
            SELECT message_id FROM message_outbox
            WHERE status IN ('pending', 'processing', 'failed') AND NOT (payload ? 'message')
        )
        """
    )
    op.execute(
        """
        UPDATE message_outbox
        SET status = 'discarded',
            last_error = 'Trabajo anterior al contrato Meta: no se envía'
        WHERE status IN ('pending', 'processing', 'failed') AND NOT (payload ? 'message')
        """
    )

    op.execute("ALTER TABLE wsp_messages DROP COLUMN status")
    op.execute("ALTER TABLE wsp_messages DROP COLUMN message_secret")


def downgrade() -> None:
    raise NotImplementedError(
        "c7e2f9a4d1b8 no se revierte: restaurar el respaldo previo a la migración"
    )
