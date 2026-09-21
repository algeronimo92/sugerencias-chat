"""Aprovisionamiento reanudable de un schema tenant mediante Alembic.

No se copian tablas ni se usa ``metadata.create_all``: cada schema recorre la
misma historia de migraciones, incluidos triggers, funciones, índices y datos
de transición declarados por las revisiones.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from uuid import UUID, uuid4

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import select, text

from db.models import (
    Organization,
    OrganizationDomain,
    TenantSchemaVersion,
    WhatsAppConnection,
)
from db.session import control_session, get_engine
from services.db_service import seed_admin_if_needed
from services.session_service import revoke_all_sessions_in_current_tenant
from services.settings_service import update_settings
from services.ws_manager import manager as ws_manager
from tenancy.context import (
    TenantContext,
    build_storage_segment,
    tenant_context,
    validate_schema_name,
)
from tenancy.resolver import normalize_hostname


logger = logging.getLogger(__name__)
BACKEND_DIR = Path(__file__).resolve().parent.parent


class TenantProvisioningError(RuntimeError):
    pass


def _alembic_config() -> Config:
    config = Config(str(BACKEND_DIR / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_DIR / "alembic"))
    return config


def tenant_migration_head() -> str:
    return ScriptDirectory.from_config(_alembic_config()).get_current_head()


def _run_tenant_alembic(sync_connection, schema_name: str) -> None:
    """Callback sync para ``AsyncConnection.run_sync``."""

    schema_name = validate_schema_name(schema_name)
    config = _alembic_config()
    config.attributes["connection"] = sync_connection
    config.attributes["tenant_schema"] = schema_name
    command.upgrade(config, "head")


async def _load_by_hostname(hostname: str):
    async with control_session() as session:
        result = await session.execute(
            select(Organization, OrganizationDomain)
            .join(
                OrganizationDomain,
                OrganizationDomain.organization_id == Organization.id,
            )
            .where(OrganizationDomain.hostname == hostname)
        )
        return result.one_or_none()


async def _prepare_control_records(
    *,
    name: str,
    hostname: str,
    provider: str | None,
    phone_number_id: str | None,
    waba_id: str | None,
) -> tuple[TenantContext, bool]:
    """Crea o retoma registros y devuelve (contexto, ya_actualizado)."""

    existing = await _load_by_hostname(hostname)
    head = tenant_migration_head()
    if existing is not None:
        organization, domain = existing
        if organization.name != name:
            raise TenantProvisioningError(
                "hostname already belongs to a different organization name"
            )
        if organization.status in {"suspended", "deleting"}:
            raise TenantProvisioningError(
                f"organization cannot be provisioned while {organization.status}"
            )
        organization_id = UUID(str(organization.id))
        # Los negocios creados antes de la columna no tienen carpeta asignada;
        # se les calcula ahora y queda fija para siempre.
        storage_segment = organization.storage_prefix or build_storage_segment(
            organization_id, organization.name
        )
        context = TenantContext(
            organization_id, organization.schema_name, domain.hostname, storage_segment
        )
        async with control_session() as session:
            if organization.storage_prefix is None:
                managed_org = await session.get(Organization, str(organization.id))
                managed_org.storage_prefix = storage_segment
            version = await session.get(TenantSchemaVersion, str(organization.id))
            current = bool(
                organization.status == "active"
                and version is not None
                and version.migration_status == "current"
                and version.revision == head
            )
            if not current:
                managed = await session.get(Organization, str(organization.id))
                managed.status = "provisioning"
                if version is None:
                    version = TenantSchemaVersion(organization_id=str(organization.id))
                    session.add(version)
                version.migration_status = "running"
                version.started_at = datetime.now(timezone.utc)
                version.finished_at = None
                version.last_error = None
        return context, current

    organization_id = uuid4()
    schema_name = validate_schema_name(f"tenant_{organization_id.hex}")
    storage_segment = build_storage_segment(organization_id, name)
    context = TenantContext(organization_id, schema_name, hostname, storage_segment)
    now = datetime.now(timezone.utc)
    async with control_session() as session:
        session.add(
            Organization(
                id=str(organization_id),
                name=name,
                status="provisioning",
                schema_name=schema_name,
                storage_prefix=storage_segment,
                created_at=now,
            )
        )
        session.add(
            OrganizationDomain(
                id=str(uuid4()),
                organization_id=str(organization_id),
                hostname=hostname,
                is_primary=True,
                verified_at=now,
                created_at=now,
            )
        )
        session.add(
            TenantSchemaVersion(
                organization_id=str(organization_id),
                migration_status="running",
                started_at=now,
                updated_at=now,
            )
        )
        if phone_number_id:
            session.add(
                WhatsAppConnection(
                    id=str(uuid4()),
                    organization_id=str(organization_id),
                    provider=provider or "meta",
                    phone_number_id=phone_number_id,
                    waba_id=waba_id,
                    status="provisioning",
                    created_at=now,
                    updated_at=now,
                )
            )
    return context, False


async def _migrate_schema(context: TenantContext) -> None:
    engine = get_engine()
    async with engine.begin() as connection:
        # Serializa reintentos concurrentes para este schema sin bloquear altas
        # de otros negocios. El lock se libera con la transacción.
        await connection.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:schema_name, 0))"),
            {"schema_name": context.schema_name},
        )
        preparer = connection.dialect.identifier_preparer
        quoted_schema = preparer.quote(validate_schema_name(context.schema_name))
        await connection.execute(text(f"CREATE SCHEMA IF NOT EXISTS {quoted_schema}"))
        await connection.run_sync(_run_tenant_alembic, context.schema_name)


async def _mark_failed(context: TenantContext, error: Exception) -> None:
    logger.exception("Falló el aprovisionamiento del tenant %s", context.organization_id)
    async with control_session() as session:
        organization = await session.get(Organization, str(context.organization_id))
        version = await session.get(TenantSchemaVersion, str(context.organization_id))
        if organization is not None:
            organization.status = "failed"
        if version is not None:
            version.migration_status = "failed"
            version.finished_at = datetime.now(timezone.utc)
            # No persistir SQL ni valores potencialmente sensibles.
            version.last_error = type(error).__name__


async def _mark_active(context: TenantContext) -> None:
    now = datetime.now(timezone.utc)
    async with control_session() as session:
        organization = await session.get(Organization, str(context.organization_id))
        version = await session.get(TenantSchemaVersion, str(context.organization_id))
        if organization is None or version is None:
            raise TenantProvisioningError("control records disappeared during provisioning")
        organization.status = "active"
        organization.activated_at = organization.activated_at or now
        version.revision = tenant_migration_head()
        version.migration_status = "current"
        version.finished_at = now
        version.last_error = None


async def _initialize_tenant(
    context: TenantContext,
    *,
    initial_settings: dict[str, str] | None,
    admin_email: str | None,
    admin_password_hash: str | None,
) -> None:
    """Siembra configuración y primer admin antes de hacer visible el tenant."""

    if bool(admin_email) != bool(admin_password_hash):
        raise ValueError("admin email and password hash must be provided together")
    with tenant_context(context):
        if initial_settings:
            # La misma puerta que usa la API aplica allowlist, cifra secretos e
            # invalida cachés. Repetirla con los mismos valores es idempotente.
            await update_settings(initial_settings)
        if admin_email and admin_password_hash:
            await seed_admin_if_needed(admin_email.strip().lower(), admin_password_hash)


class WhatsAppConnectionConflictError(TenantProvisioningError):
    """Ese número ya rutea hacia otro negocio."""


async def sync_whatsapp_connection(
    organization_id: UUID,
    *,
    phone_number_id: str,
    waba_id: str | None = None,
    provider: str = "meta",
) -> None:
    """Registra en el plano de control el número por el que entran los webhooks.

    El token sigue viviendo en el ``app_settings`` del negocio: acá solo van los
    campos de ruteo, que son los que ``resolve_tenant_by_phone_number_id`` lee
    *antes* de saber a qué schema pertenece el evento. Sin esta fila activa, un
    webhook de Meta no tiene forma de encontrar su tenant.
    """

    phone_number_id = phone_number_id.strip()
    if not phone_number_id:
        raise ValueError("phone_number_id is required")
    now = datetime.now(timezone.utc)
    async with control_session() as session:
        existing = (
            await session.execute(
                select(WhatsAppConnection).where(
                    WhatsAppConnection.phone_number_id == phone_number_id
                )
            )
        ).scalars().first()
        if existing is not None and str(existing.organization_id) != str(organization_id):
            # La columna es única: dejar que reviente el INSERT daría un
            # IntegrityError que no dice cuál es el problema real.
            raise WhatsAppConnectionConflictError(
                f"phone_number_id {phone_number_id} already belongs to another organization"
            )
        if existing is not None:
            existing.provider = provider
            existing.waba_id = waba_id or existing.waba_id
            existing.status = "active"
            existing.updated_at = now
            return
        session.add(
            WhatsAppConnection(
                id=str(uuid4()),
                organization_id=str(organization_id),
                provider=provider,
                phone_number_id=phone_number_id,
                waba_id=waba_id,
                status="active",
                created_at=now,
                updated_at=now,
            )
        )


async def _mark_suspended(organization_id: UUID) -> TenantContext:
    async with control_session() as session:
        organization = await session.get(Organization, str(organization_id))
        if organization is None:
            raise TenantProvisioningError("organization not found")
        domain = (
            await session.execute(
                select(OrganizationDomain).where(
                    OrganizationDomain.organization_id == str(organization_id),
                    OrganizationDomain.is_primary.is_(True),
                )
            )
        ).scalars().first()
        if domain is None:
            raise TenantProvisioningError("organization has no primary domain")
        context = TenantContext(
            UUID(str(organization.id)),
            organization.schema_name,
            domain.hostname,
            organization.storage_prefix,
        )
        organization.status = "suspended"
    return context


class DomainConflictError(TenantProvisioningError):
    """Ese hostname ya está registrado."""


async def add_organization_domain(
    organization_id: UUID, hostname: str, *, is_primary: bool = False
) -> str:
    """Suma un hostname a un negocio ya existente.

    Hasta ahora la única forma de registrar un dominio era aprovisionar: correr
    `provision_tenant` con un hostname nuevo creaba **otra** organización con su
    propio schema vacío, en vez de sumarle el dominio a la que ya estaba.
    """

    normalized = normalize_hostname(hostname)
    now = datetime.now(timezone.utc)
    async with control_session() as session:
        organization = await session.get(Organization, str(organization_id))
        if organization is None:
            raise TenantProvisioningError("organization not found")
        taken = (
            await session.execute(
                select(OrganizationDomain).where(OrganizationDomain.hostname == normalized)
            )
        ).scalars().first()
        if taken is not None:
            duenio = (
                "este negocio"
                if str(taken.organization_id) == str(organization_id)
                else "otro negocio"
            )
            raise DomainConflictError(f"{normalized} ya está registrado para {duenio}")

        if is_primary:
            # El índice parcial de `is_primary` admite uno solo por negocio.
            for domain in (
                await session.execute(
                    select(OrganizationDomain).where(
                        OrganizationDomain.organization_id == str(organization_id),
                        OrganizationDomain.is_primary.is_(True),
                    )
                )
            ).scalars():
                domain.is_primary = False

        session.add(
            OrganizationDomain(
                id=str(uuid4()),
                organization_id=str(organization_id),
                hostname=normalized,
                is_primary=is_primary,
                verified_at=now,
                created_at=now,
            )
        )
    return normalized


async def remove_organization_domain(organization_id: UUID, hostname: str) -> None:
    """Quita un hostname. El principal no se puede quitar: es el que usan los
    workers y el ruteo de webhooks para ubicar al negocio."""

    normalized = normalize_hostname(hostname)
    async with control_session() as session:
        domain = (
            await session.execute(
                select(OrganizationDomain).where(
                    OrganizationDomain.organization_id == str(organization_id),
                    OrganizationDomain.hostname == normalized,
                )
            )
        ).scalars().first()
        if domain is None:
            raise TenantProvisioningError("domain not found for this organization")
        if domain.is_primary:
            raise TenantProvisioningError(
                "no se puede quitar el dominio principal; promové otro primero"
            )
        await session.delete(domain)


async def activate_organization(organization_id: UUID) -> None:
    """Reactiva un negocio suspendido, solo si su schema está al día.

    Volver a `active` con el schema en una revisión vieja lo dejaría sirviendo
    tráfico contra tablas que este binario no sabe leer, y además rompería el
    arranque siguiente (`_verify_active_tenant_schemas`).
    """

    head = tenant_migration_head()
    async with control_session() as session:
        organization = await session.get(Organization, str(organization_id))
        if organization is None:
            raise TenantProvisioningError("organization not found")
        if organization.status not in {"suspended", "active"}:
            raise TenantProvisioningError(
                f"organization cannot be activated while {organization.status}"
            )
        version = await session.get(TenantSchemaVersion, str(organization_id))
        if version is None or version.revision != head or version.migration_status != "current":
            raise TenantProvisioningError(
                "el schema del negocio no está en la revisión actual; migrá antes de reactivar"
            )
        organization.status = "active"
        organization.activated_at = organization.activated_at or datetime.now(timezone.utc)


async def suspend_organization(organization_id: UUID) -> TenantContext:
    """Suspende un negocio y corta lo que ya estaba abierto, no solo lo nuevo.

    `resolve_tenant_by_hostname` ya filtra `status == 'active'`, así que en
    cuanto `_mark_suspended` confirma, el middleware empieza a rechazar con
    404 cualquier request HTTP o intento de WebSocket *nuevo* para ese host.
    Pero eso no alcanza lo que ya estaba conectado: una sesión de navegador
    con cookie todavía válida no vuelve a pasar por el resolver hasta que
    expira, y un WebSocket ya aceptado no pasa por el middleware de nuevo en
    absoluto. Por eso hace falta revocar `auth_sessions` del schema (con su
    cache en memoria) y cerrar los sockets ya abiertos a mano."""

    context = await _mark_suspended(organization_id)
    with tenant_context(context):
        await revoke_all_sessions_in_current_tenant()
    await ws_manager.disconnect_organization(context.organization_id)
    return context


async def provision_tenant(
    *,
    name: str,
    hostname: str,
    provider: str | None = None,
    phone_number_id: str | None = None,
    waba_id: str | None = None,
    initial_settings: dict[str, str] | None = None,
    admin_email: str | None = None,
    admin_password_hash: str | None = None,
) -> TenantContext:
    """Crea o reanuda un tenant y solo lo activa al alcanzar Alembic head."""

    normalized_hostname = normalize_hostname(hostname)
    if not name.strip():
        raise ValueError("organization name is required")
    context, current = await _prepare_control_records(
        name=name.strip(),
        hostname=normalized_hostname,
        provider=provider,
        phone_number_id=phone_number_id,
        waba_id=waba_id,
    )
    if current:
        return context
    try:
        await _migrate_schema(context)
        await _initialize_tenant(
            context,
            initial_settings=initial_settings,
            admin_email=admin_email,
            admin_password_hash=admin_password_hash,
        )
        await _mark_active(context)
    except Exception as exc:
        await _mark_failed(context, exc)
        raise TenantProvisioningError(
            f"tenant {context.organization_id} could not be provisioned"
        ) from exc
    return context
