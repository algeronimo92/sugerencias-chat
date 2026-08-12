"""Catálogo de categorías de plantillas.

Revision ID: f8a4d1c72e90
Revises: e2c6a8f41d73
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "f8a4d1c72e90"
down_revision: Union[str, None] = "e2c6a8f41d73"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "template_categories",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_by", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.ForeignKeyConstraint(["created_by"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )
    op.create_index("idx_template_categories_created_by", "template_categories", ["created_by"])
    op.create_index(
        "uq_template_categories_name_lower",
        "template_categories",
        [sa.text("lower(name)")],
        unique=True,
    )

    op.execute(
        """
        INSERT INTO template_categories (name, is_active, created_at)
        VALUES
          ('General', true, now()),
          ('Seguimiento', true, now())
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO template_categories (name, is_active, created_at)
        SELECT MIN(btrim(category)), true, now()
        FROM message_templates
        WHERE visibility = 'global'
          AND NULLIF(btrim(category), '') IS NOT NULL
        GROUP BY lower(btrim(category))
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        UPDATE message_templates AS template
        SET category = category.name
        FROM template_categories AS category
        WHERE lower(btrim(template.category)) = lower(category.name)
          AND template.category IS DISTINCT FROM category.name
        """
    )


def downgrade() -> None:
    op.drop_index("uq_template_categories_name_lower", table_name="template_categories")
    op.drop_index("idx_template_categories_created_by", table_name="template_categories")
    op.drop_table("template_categories")
