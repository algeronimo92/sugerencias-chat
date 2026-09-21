"""Autoría de los mensajes salientes y vínculo cita -> lead.

Dos huecos que impedían medir el trabajo real de un vendedor:

1. `wsp_messages` solo distinguía cliente/vendedor, así que "mensajes que yo
   envié" no existía — lo más cercano era "mensajes de vendedor en leads
   asignados a mí", que se rompe cuando otro contesta el chat. La columna se
   rellena desde `message_outbox.payload->>'_actor_user_id'`, que ya venía
   guardando ese dato en cada envío hecho desde la app (las filas del outbox no
   se purgan, quedan en `sent`). Los ecos que llegan por webhook desde el
   celular del vendedor quedan en NULL: WhatsApp no dice qué usuario del CRM
   escribió, y suponerlo sería inventar la métrica.

2. `appointments` no apuntaba al lead, así que una cita registrada no se podía
   abrir en su chat ni cruzar con el pipeline. El backfill empareja por los
   últimos 9 dígitos del teléfono y solo cuando ese final identifica a un único
   lead — con dos candidatos preferimos dejarlo en NULL antes que colgar la cita
   del lead equivocado.

Revision ID: a7f2c48d16be
Revises: d1a5e83c47b9
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID as PG_UUID


revision: str = "a7f2c48d16be"
down_revision: Union[str, None] = "d1a5e83c47b9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# El EXISTS sobre users evita romper la FK si el actor guardado en el payload
# fue borrado desde entonces.
_BACKFILL_MESSAGE_AUTHORS = """
UPDATE wsp_messages AS m
SET sent_by_user_id = (o.payload ->> '_actor_user_id')::int
FROM message_outbox AS o
WHERE o.message_id = m.id
  AND m.sender = 'vendedor'
  AND m.sent_by_user_id IS NULL
  AND o.payload ? '_actor_user_id'
  AND EXISTS (
    SELECT 1 FROM users AS u WHERE u.id = (o.payload ->> '_actor_user_id')::int
  )
"""

# Los mensajes programados no pasan por el payload del outbox con actor: su
# autor es quien programó el envío.
_BACKFILL_SCHEDULED_AUTHORS = """
UPDATE wsp_messages AS m
SET sent_by_user_id = s.created_by_user_id
FROM scheduled_messages AS s
WHERE s.queued_message_id = m.id
  AND m.sender = 'vendedor'
  AND m.sent_by_user_id IS NULL
  AND EXISTS (SELECT 1 FROM users AS u WHERE u.id = s.created_by_user_id)
"""

# Solo los teléfonos cuyo final de 9 dígitos pertenece a un único lead; el resto
# se queda sin vincular a propósito.
_BACKFILL_APPOINTMENT_LEADS = r"""
UPDATE appointments AS a
SET lead_id = unico.lead_id
FROM (
    SELECT right(regexp_replace(telefono, '\D', '', 'g'), 9) AS cola,
           min(id::text)::uuid AS lead_id
    FROM leads
    WHERE telefono IS NOT NULL
      AND length(regexp_replace(telefono, '\D', '', 'g')) >= 9
    GROUP BY 1
    HAVING count(*) = 1
) AS unico
WHERE a.lead_id IS NULL
  AND length(regexp_replace(a.telefono, '\D', '', 'g')) >= 9
  AND right(regexp_replace(a.telefono, '\D', '', 'g'), 9) = unico.cola
"""


def upgrade() -> None:
    op.add_column("wsp_messages", sa.Column("sent_by_user_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_wsp_messages_sent_by_user_id",
        "wsp_messages", "users",
        ["sent_by_user_id"], ["id"],
        ondelete="SET NULL",
    )
    # Parcial: la enorme mayoría de las filas son mensajes del cliente o ecos
    # sin autor conocido, y no aportan nada al índice.
    op.create_index(
        "idx_wsp_messages_author_sent",
        "wsp_messages",
        ["sent_by_user_id", sa.text("sent_at DESC")],
        postgresql_where=sa.text("sent_by_user_id IS NOT NULL"),
    )

    op.add_column("appointments", sa.Column("lead_id", PG_UUID(as_uuid=False), nullable=True))
    op.create_foreign_key(
        "fk_appointments_lead_id",
        "appointments", "leads",
        ["lead_id"], ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "idx_appointments_lead_created",
        "appointments",
        ["lead_id", sa.text("created_at DESC")],
        postgresql_where=sa.text("lead_id IS NOT NULL"),
    )

    op.execute(_BACKFILL_MESSAGE_AUTHORS)
    op.execute(_BACKFILL_SCHEDULED_AUTHORS)
    op.execute(_BACKFILL_APPOINTMENT_LEADS)


def downgrade() -> None:
    op.drop_index("idx_appointments_lead_created", table_name="appointments")
    op.drop_constraint("fk_appointments_lead_id", "appointments", type_="foreignkey")
    op.drop_column("appointments", "lead_id")

    op.drop_index("idx_wsp_messages_author_sent", table_name="wsp_messages")
    op.drop_constraint("fk_wsp_messages_sent_by_user_id", "wsp_messages", type_="foreignkey")
    op.drop_column("wsp_messages", "sent_by_user_id")
