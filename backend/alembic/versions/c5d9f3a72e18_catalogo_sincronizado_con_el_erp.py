"""Catálogo sincronizado desde el ERP del negocio.

Revision ID: c5d9f3a72e18
Revises: a4c8e2f61b93
Create Date: 2026-11-07

DermicaPro ya tiene la lista de precios en su ERP (``/api/public/catalog``:
servicios con paquetes de N sesiones). Cargarla otra vez a mano en el CRM era
tener dos fuentes de precios; el asistente IA cotizaría con la vieja.

``external_id`` guarda el identificador del ERP en servicios y paquetes para
que la sincronización sea idempotente y sobreviva a los renombres: un
servicio con ``external_id`` lo administra el ERP, uno sin él lo cargó el
negocio a mano en el CRM. La URL del catálogo y el estado de la última
sincronización viven en ``app_settings`` (``erp_catalog_*``).

Plano tenant: corre en cada schema. ``migrate.py`` también recorre public,
donde puede no existir ``lead_services``: ahí no se hace nada.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "c5d9f3a72e18"
down_revision: Union[str, None] = "a4c8e2f61b93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "service_packages"):
        return
    op.add_column("lead_services", sa.Column("external_id", sa.Text(), nullable=True))
    op.add_column("service_packages", sa.Column("external_id", sa.Text(), nullable=True))
    op.create_index(
        "uq_lead_services_external_id",
        "lead_services",
        ["external_id"],
        unique=True,
        postgresql_where=sa.text("external_id IS NOT NULL"),
    )
    op.create_index(
        "uq_service_packages_external_id",
        "service_packages",
        ["external_id"],
        unique=True,
        postgresql_where=sa.text("external_id IS NOT NULL"),
    )


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "service_packages"):
        return
    op.drop_index("uq_service_packages_external_id", table_name="service_packages")
    op.drop_index("uq_lead_services_external_id", table_name="lead_services")
    op.drop_column("service_packages", "external_id")
    op.drop_column("lead_services", "external_id")


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None
