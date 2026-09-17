"""Resolución de un hostname registrado hacia su contexto tenant."""

from __future__ import annotations

import ipaddress
import re
from uuid import UUID

from sqlalchemy import select

from db.models import Organization, OrganizationDomain, WhatsAppConnection
from db.session import control_session
from tenancy.context import TenantContext


_HOST_LABEL_RE = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)$")


def normalize_hostname(raw_host: str | None) -> str:
    """Normaliza un Host HTTP y rechaza IPs, listas y sintaxis ambigua."""

    if raw_host is None:
        raise ValueError("missing host header")
    candidate = raw_host.strip().lower()
    if not candidate or any(char in candidate for char in " ,/@\\?#"):
        raise ValueError("invalid host header")

    if candidate.count(":") > 1:
        # Las IP literales (incluidas IPv6) nunca identifican un negocio.
        raise ValueError("IP hosts are not tenant domains")
    if ":" in candidate:
        candidate, port = candidate.rsplit(":", 1)
        if not port.isdigit() or not 1 <= int(port) <= 65535:
            raise ValueError("invalid host port")

    candidate = candidate.rstrip(".")
    try:
        hostname = candidate.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError("invalid host encoding") from exc

    if len(hostname) > 253 or not hostname:
        raise ValueError("invalid hostname length")
    if any(not _HOST_LABEL_RE.fullmatch(label) for label in hostname.split(".")):
        raise ValueError("invalid hostname")
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        return hostname
    raise ValueError("IP hosts are not tenant domains")


async def resolve_tenant_by_hostname(hostname: str) -> TenantContext | None:
    """Devuelve solo organizaciones activas asociadas al hostname exacto."""

    hostname = normalize_hostname(hostname)
    async with control_session() as session:
        result = await session.execute(
            select(
                Organization.id.label("organization_id"),
                Organization.schema_name,
                OrganizationDomain.hostname,
            )
            .join(
                OrganizationDomain,
                OrganizationDomain.organization_id == Organization.id,
            )
            .where(
                OrganizationDomain.hostname == hostname,
                Organization.status == "active",
            )
        )
        row = result.mappings().one_or_none()
    if row is None:
        return None
    return TenantContext(
        organization_id=UUID(str(row["organization_id"])),
        schema_name=row["schema_name"],
        hostname=row["hostname"],
    )


async def resolve_tenant_by_phone_number_id(phone_number_id: str) -> TenantContext | None:
    """Resuelve el receptor Meta usando la conexión activa del plano de control."""

    async with control_session() as session:
        result = await session.execute(
            select(
                Organization.id.label("organization_id"),
                Organization.schema_name,
                OrganizationDomain.hostname,
            )
            .join(
                WhatsAppConnection,
                WhatsAppConnection.organization_id == Organization.id,
            )
            .join(
                OrganizationDomain,
                OrganizationDomain.organization_id == Organization.id,
            )
            .where(
                WhatsAppConnection.phone_number_id == phone_number_id,
                WhatsAppConnection.status == "active",
                Organization.status == "active",
                OrganizationDomain.is_primary.is_(True),
            )
        )
        row = result.mappings().one_or_none()
    if row is None:
        return None
    return TenantContext(
        organization_id=UUID(str(row["organization_id"])),
        schema_name=row["schema_name"],
        hostname=row["hostname"],
    )


async def resolve_tenant_by_organization_id(
    organization_id: UUID,
) -> TenantContext | None:
    """Resuelve el tenant ligado a un token interno ya verificado."""

    async with control_session() as session:
        result = await session.execute(
            select(
                Organization.id.label("organization_id"),
                Organization.schema_name,
                OrganizationDomain.hostname,
            )
            .join(
                OrganizationDomain,
                OrganizationDomain.organization_id == Organization.id,
            )
            .where(
                Organization.id == str(organization_id),
                Organization.status == "active",
                OrganizationDomain.is_primary.is_(True),
            )
        )
        row = result.mappings().one_or_none()
    if row is None:
        return None
    return TenantContext(
        organization_id=UUID(str(row["organization_id"])),
        schema_name=row["schema_name"],
        hostname=row["hostname"],
    )


async def list_active_tenants() -> list[TenantContext]:
    """Snapshot sin caché para coordinadores; cada unidad abre su propia sesión."""

    async with control_session() as session:
        result = await session.execute(
            select(
                Organization.id.label("organization_id"),
                Organization.schema_name,
                OrganizationDomain.hostname,
            )
            .join(
                OrganizationDomain,
                OrganizationDomain.organization_id == Organization.id,
            )
            .where(
                Organization.status == "active",
                OrganizationDomain.is_primary.is_(True),
            )
            .order_by(Organization.id)
        )
        rows = result.mappings().all()
    return [
        TenantContext(
            organization_id=UUID(str(row["organization_id"])),
            schema_name=row["schema_name"],
            hostname=row["hostname"],
        )
        for row in rows
    ]


# Nombre corto conservado para consumidores creados durante la primera etapa.
resolve_tenant = resolve_tenant_by_hostname
