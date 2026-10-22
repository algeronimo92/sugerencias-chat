"""FK de categorias y servicios usados por plantillas.

Revision ID: fb6d9c3e2a41
Revises: a7d3f5c21b90

Las plantillas conservan los nombres en sus respuestas publicas para no
romper el frontend ni las integraciones existentes, pero esos nombres pasan
a estar respaldados por los catalogos. Los renombrados se propagan en la
base y un elemento usado no puede eliminarse.
"""

from typing import Sequence, Union

from alembic import op


revision: str = "fb6d9c3e2a41"
down_revision: Union[str, None] = "a7d3f5c21b90"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Primero se incorporan al catalogo todos los valores historicos. Las
    # categorias exclusivas de plantillas personales quedan inactivas para
    # que no aparezcan como opcion de las plantillas compartidas.
    op.execute(
        """
        WITH candidates AS (
            SELECT MIN(btrim(category)) AS name,
                   bool_or(visibility = 'global') AS is_active
            FROM message_templates
            WHERE NULLIF(btrim(category), '') IS NOT NULL
            GROUP BY lower(btrim(category))
        )
        INSERT INTO template_categories (name, is_active, created_at)
        SELECT candidate.name, candidate.is_active, now()
        FROM candidates AS candidate
        WHERE NOT EXISTS (
            SELECT 1
            FROM template_categories AS category
            WHERE lower(category.name) = lower(candidate.name)
        )
        """
    )
    op.execute(
        """
        INSERT INTO template_categories (name, is_active, created_at)
        VALUES ('General', true, now())
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        INSERT INTO template_categories (name, is_active, created_at)
        VALUES ('personal', false, now())
        ON CONFLICT DO NOTHING
        """
    )
    op.execute(
        """
        UPDATE message_templates
        SET category = 'General'
        WHERE NULLIF(btrim(category), '') IS NULL
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

    op.execute(
        """
        UPDATE message_templates
        SET service = NULL
        WHERE service IS NOT NULL AND NULLIF(btrim(service), '') IS NULL
        """
    )
    op.execute(
        """
        WITH candidates AS (
            SELECT MIN(btrim(service)) AS name
            FROM message_templates
            WHERE NULLIF(btrim(service), '') IS NOT NULL
            GROUP BY lower(btrim(service))
        )
        INSERT INTO lead_services (name, is_active, created_at)
        SELECT candidate.name, true, now()
        FROM candidates AS candidate
        WHERE NOT EXISTS (
            SELECT 1
            FROM lead_services AS service
            WHERE lower(service.name) = lower(candidate.name)
        )
        """
    )
    op.execute(
        """
        UPDATE message_templates AS template
        SET service = service.name
        FROM lead_services AS service
        WHERE lower(btrim(template.service)) = lower(service.name)
          AND template.service IS DISTINCT FROM service.name
        """
    )

    op.create_foreign_key(
        "fk_message_templates_category_catalog",
        "message_templates",
        "template_categories",
        ["category"],
        ["name"],
        onupdate="CASCADE",
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        "fk_message_templates_service_catalog",
        "message_templates",
        "lead_services",
        ["service"],
        ["name"],
        onupdate="CASCADE",
        ondelete="RESTRICT",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_message_templates_service_catalog",
        "message_templates",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_message_templates_category_catalog",
        "message_templates",
        type_="foreignkey",
    )
