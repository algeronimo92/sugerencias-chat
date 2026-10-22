"""Campos personalizados por negocio y calendario propio de citas.

Revision ID: e1f4a7c9d2b6
Revises: 7c1a9e4b2d60
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "e1f4a7c9d2b6"
down_revision: Union[str, None] = "7c1a9e4b2d60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "custom_field_definitions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("entity_type", sa.Text(), nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=False),
        sa.Column("field_type", sa.Text(), nullable=False),
        sa.Column("required", sa.Boolean(), server_default=sa.text("false"), nullable=False),
        sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'[]'::jsonb"), nullable=False),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("entity_type IN ('lead', 'appointment')", name="custom_fields_entity_check"),
        sa.CheckConstraint("field_type IN ('text', 'textarea', 'number', 'date', 'datetime', 'boolean', 'select')", name="custom_fields_type_check"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("uq_custom_fields_entity_key", "custom_field_definitions", ["entity_type", "key"], unique=True)
    op.create_index("idx_custom_fields_entity_position", "custom_field_definitions", ["entity_type", "position", "id"])

    # leads es una tabla compartida con n8n y está fuera de autogenerate; el
    # cambio se declara de forma explícita.
    op.add_column(
        "leads",
        sa.Column("custom_fields", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
    )
    op.add_column("appointments", sa.Column("duration_minutes", sa.Integer(), server_default="60", nullable=False))
    op.add_column(
        "appointments",
        sa.Column("custom_fields", postgresql.JSONB(astext_type=sa.Text()), server_default=sa.text("'{}'::jsonb"), nullable=False),
    )
    op.add_column("appointments", sa.Column("calendar_event_id", sa.Text(), nullable=True))
    op.add_column("appointments", sa.Column("calendar_sync_status", sa.Text(), server_default="not_configured", nullable=False))
    op.add_column("appointments", sa.Column("calendar_sync_error", sa.Text(), nullable=True))
    op.create_check_constraint(
        "ck_appointments_duration", "appointments", "duration_minutes BETWEEN 5 AND 1440"
    )
    op.create_check_constraint(
        "ck_appointments_calendar_sync",
        "appointments",
        "calendar_sync_status IN ('not_configured', 'pending', 'synced', 'error', 'skipped')",
    )
    op.create_index("idx_appointments_date_time", "appointments", ["fecha", "hora"])


def downgrade() -> None:
    op.drop_index("idx_appointments_date_time", table_name="appointments")
    op.drop_constraint("ck_appointments_calendar_sync", "appointments", type_="check")
    op.drop_constraint("ck_appointments_duration", "appointments", type_="check")
    op.drop_column("appointments", "calendar_sync_error")
    op.drop_column("appointments", "calendar_sync_status")
    op.drop_column("appointments", "calendar_event_id")
    op.drop_column("appointments", "custom_fields")
    op.drop_column("appointments", "duration_minutes")
    op.drop_column("leads", "custom_fields")
    op.drop_index("idx_custom_fields_entity_position", table_name="custom_field_definitions")
    op.drop_index("uq_custom_fields_entity_key", table_name="custom_field_definitions")
    op.drop_table("custom_field_definitions")
