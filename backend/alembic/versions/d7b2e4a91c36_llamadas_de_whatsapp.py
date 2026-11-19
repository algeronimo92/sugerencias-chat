"""Llamadas de voz de WhatsApp.

Revision ID: d7b2e4a91c36
Revises: c41d9a7e5b20
Create Date: 2026-11-19

Una fila por llamada con un lead (docs/analisis/17-plan-llamadas-whatsapp.md,
§4.3). Los índices únicos parciales garantizan una sola llamada viva por chat
y una por agente, aunque lleguen eventos duplicados o desde dos workers.

Plano tenant: corre en cada schema; donde no está ``leads`` (el schema
``public`` de la plataforma) no hace nada.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = 'd7b2e4a91c36'
down_revision: Union[str, None] = 'c41d9a7e5b20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if not _table_exists(op.get_bind(), "leads"):
        return
    op.create_table('whatsapp_calls',
    sa.Column('id', sa.BigInteger(), nullable=False),
    sa.Column('wa_call_id', sa.Text(), nullable=True),
    sa.Column('chat_id', sa.UUID(as_uuid=False), nullable=False),
    sa.Column('phone_number_id', sa.Text(), nullable=False),
    sa.Column('direction', sa.Text(), nullable=False),
    sa.Column('status', sa.Text(), nullable=False),
    sa.Column('cause', sa.Text(), nullable=True),
    sa.Column('error_code', sa.Text(), nullable=True),
    sa.Column('closed_by', sa.Text(), nullable=True),
    sa.Column('ringing_at', sa.DateTime(timezone=True), nullable=False),
    sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('duration_seconds', sa.Integer(), nullable=True),
    sa.Column('handled_by_user_id', sa.Integer(), nullable=True),
    sa.Column('claimed_by_client_id', sa.Text(), nullable=True),
    sa.Column('claim_expires_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('dismissed_by', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
    sa.Column('remote_sdp', sa.Text(), nullable=True),
    sa.Column('events', postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.CheckConstraint("direction IN ('inbound', 'outbound')", name='whatsapp_calls_direction_check'),
    sa.CheckConstraint("status IN ('dialing', 'ringing', 'connecting', 'accepted', 'completed', 'missed', 'rejected', 'failed')", name='whatsapp_calls_status_check'),
    sa.ForeignKeyConstraint(['chat_id'], ['leads.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['handled_by_user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index('idx_whatsapp_calls_chat', 'whatsapp_calls', ['chat_id', sa.literal_column('ringing_at DESC')], unique=False)
    op.create_index('idx_whatsapp_calls_open', 'whatsapp_calls', ['status', 'ringing_at'], unique=False, postgresql_where=sa.text("status IN ('dialing', 'ringing', 'connecting', 'accepted')"))
    op.create_index('uq_whatsapp_calls_live_agent', 'whatsapp_calls', ['handled_by_user_id'], unique=True, postgresql_where=sa.text("status IN ('dialing', 'connecting', 'accepted') AND handled_by_user_id IS NOT NULL"))
    op.create_index('uq_whatsapp_calls_live_chat', 'whatsapp_calls', ['chat_id'], unique=True, postgresql_where=sa.text("status IN ('dialing', 'ringing', 'connecting', 'accepted')"))
    op.create_index('uq_whatsapp_calls_wa_call_id', 'whatsapp_calls', ['wa_call_id'], unique=True, postgresql_where=sa.text('wa_call_id IS NOT NULL'))


def downgrade() -> None:
    if not _table_exists(op.get_bind(), "whatsapp_calls"):
        return
    op.drop_index('uq_whatsapp_calls_wa_call_id', table_name='whatsapp_calls', postgresql_where=sa.text('wa_call_id IS NOT NULL'))
    op.drop_index('uq_whatsapp_calls_live_chat', table_name='whatsapp_calls', postgresql_where=sa.text("status IN ('dialing', 'ringing', 'connecting', 'accepted')"))
    op.drop_index('uq_whatsapp_calls_live_agent', table_name='whatsapp_calls', postgresql_where=sa.text("status IN ('dialing', 'connecting', 'accepted') AND handled_by_user_id IS NOT NULL"))
    op.drop_index('idx_whatsapp_calls_open', table_name='whatsapp_calls', postgresql_where=sa.text("status IN ('dialing', 'ringing', 'connecting', 'accepted')"))
    op.drop_index('idx_whatsapp_calls_chat', table_name='whatsapp_calls')
    op.drop_table('whatsapp_calls')


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None
