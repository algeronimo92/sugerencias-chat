"""Paquetes por servicio: el cierre es un paquete, no un servicio suelto.

Revision ID: a4c8e2f61b93
Revises: e2c9a4f71d38
Create Date: 2026-11-07

El cliente llega con un problema (el servicio: Hollywood Peel) y el vendedor
cierra con la presentación que lo resuelve (1 sesión, pack x3, pack x5...).
Hasta ahora el servicio tenía un único ``price`` y los packs se anotaban a
mano en ``price_notes``: el asistente IA cotizaba leyendo texto libre.

``service_packages`` guarda cada presentación con sus sesiones y su precio
total. El ``price`` que el negocio ya había cargado se conserva como un
paquete "1 sesión" y la columna desaparece de ``lead_services`` para que el
precio viva en un solo lugar. ``price_notes`` sigue como nota general.

Plano tenant: corre en cada schema. ``migrate.py`` también recorre public,
donde puede no existir ``lead_services``: ahí no se hace nada.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a4c8e2f61b93"
down_revision: Union[str, None] = "e2c9a4f71d38"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "lead_services"):
        return

    op.create_table(
        "service_packages",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("service_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("sessions", sa.Integer(), server_default="1", nullable=False),
        sa.Column("price", sa.Numeric(12, 2), nullable=False),
        sa.Column("notes", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), server_default="0", nullable=False),
        sa.Column("is_active", sa.Boolean(), server_default="true", nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("sessions >= 1", name="service_packages_sessions_check"),
        sa.CheckConstraint("price >= 0", name="service_packages_price_check"),
        sa.ForeignKeyConstraint(["service_id"], ["lead_services.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "uq_service_packages_service_name_lower",
        "service_packages",
        ["service_id", sa.text("lower(name)")],
        unique=True,
    )
    op.create_index(
        "idx_service_packages_service_position",
        "service_packages",
        ["service_id", "position", "id"],
    )

    # Lo que el negocio ya cotizaba como precio del servicio era, en la
    # práctica, el precio de una sesión suelta: no se pierde.
    op.execute(
        "INSERT INTO service_packages (service_id, name, sessions, price, position, is_active) "
        "SELECT id, '1 sesión', 1, price, 0, is_active FROM lead_services WHERE price IS NOT NULL"
    )

    op.drop_constraint("lead_services_price_check", "lead_services", type_="check")
    op.drop_column("lead_services", "price")


def downgrade() -> None:
    bind = op.get_bind()
    if not _table_exists(bind, "service_packages"):
        return

    op.add_column("lead_services", sa.Column("price", sa.Numeric(12, 2), nullable=True))
    op.create_check_constraint(
        "lead_services_price_check", "lead_services", "price IS NULL OR price >= 0"
    )
    # Vuelve al servicio el precio de la sesión suelta (la activa primero, en
    # su orden); los demás paquetes no caben en una sola columna y se pierden.
    op.execute(
        "UPDATE lead_services s SET price = p.price FROM ("
        "  SELECT DISTINCT ON (service_id) service_id, price FROM service_packages"
        "  WHERE sessions = 1 ORDER BY service_id, is_active DESC, position, id"
        ") p WHERE p.service_id = s.id"
    )
    op.drop_index("idx_service_packages_service_position", table_name="service_packages")
    op.drop_index("uq_service_packages_service_name_lower", table_name="service_packages")
    op.drop_table("service_packages")


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None
