"""Arranque y trabajo de fondo, compartidos por la API y el worker.

``prepare`` deja la base y la configuración listas (espera a PostgreSQL,
verifica migraciones, normaliza la configuración cifrada y corre los
backfills idempotentes). ``start_background`` arranca el bus de señales y
los ciclos de los workers que le tocan a cada proceso:

- La API corre solo lo que depende de su propio proceso: los recordatorios
  de tareas (se liberan si el usuario no está conectado a esta réplica) y
  las métricas de colas que publica su ``/metrics``. Con
  ``RUN_WORKERS=true`` (el default, una sola instancia) corre además todo lo
  demás.
- El worker (``python -m app.worker``) corre los ciclos de fondo: chats,
  automatizaciones, outbox, programados y el inbox de Meta.

Que dos procesos corran el mismo ciclo a la vez (el solapamiento de un
despliegue blue-green) es seguro: cada cola reclama con ``SKIP LOCKED`` y
las altas se deduplican por índices únicos (outbox por ``dedupe_key``,
automatizaciones por ``(rule_id, event_key)``, inbox de Meta por id de
evento).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging

from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import settings
from app.db.session import close_engine, get_engine
from app.db.signals import run_bus
from app.integrations.meta.client import close_meta_client
from app.integrations.meta_webhook.worker import watch_meta_webhook_inbox
from app.integrations.n8n.client import close_n8n_client
from app.integrations.storage.media_storage import storage_backend
from app.integrations.tts_service import close_tts_client
from app.modules.auth.auth_service import hash_password
from app.modules.auth.users_repository import seed_admin_if_needed
from app.modules.automations.public import automations_tick, backfill_automation_state, wait_for_automation_work
from app.modules.conversations.chat_queries import set_unaccent_enabled
from app.modules.conversations.chat_watcher import POLL_INTERVAL_SECONDS, chat_watcher_tick
from app.modules.conversations.infrastructure.outbox_worker import outbox_tick, wait_for_outbox_work
from app.modules.conversations.infrastructure.scheduled_worker import POLL_SECONDS as SCHEDULED_POLL_SECONDS
from app.modules.conversations.infrastructure.scheduled_worker import scheduled_tick
from app.modules.platform.platform_settings import migrate_legacy_platform_settings, platform_setting
from app.modules.platform.settings_service import migrate_settings_encryption
from app.modules.tasks.task_reminder import deliver_due_reminders
from app.realtime.queue_metrics import POLL_SECONDS as METRICS_POLL_SECONDS
from app.realtime.queue_metrics import queue_metrics_tick
from app.tenancy.context import tenant_context, validate_schema_name
from app.tenancy.resolver import list_active_tenants
from app.workers.tenant_supervisor import CachedTenants, TenantLoop, run_tenant_loop, single_tenant, sleeping

logger = logging.getLogger(__name__)
DATABASE_RETRY_MAX_SECONDS = 30


async def _wait_for_database() -> None:
    """Espera a que PostgreSQL acepte conexiones, con backoff.

    Sustituye a la transacción que antes abría el DDL de arranque. Se conserva
    la espera porque el contenedor puede levantar antes que la base esté lista,
    y sin ella el proceso moriría en bucle en vez de reintentar.
    """
    attempt = 0
    while True:
        attempt += 1
        try:
            async with get_engine().connect() as connection:
                await connection.execute(text("SELECT 1"))
            if attempt > 1:
                logger.info("Conexión a la base de datos recuperada tras %s intentos", attempt)
            return
        except (OSError, SQLAlchemyError) as exc:
            await close_engine()
            delay = min(2 ** (attempt - 1), DATABASE_RETRY_MAX_SECONDS)
            logger.warning(
                "Base de datos no disponible durante el arranque (intento %s, %s); reintentando en %ss",
                attempt,
                type(exc).__name__,
                delay,
            )
            await asyncio.sleep(delay)


class SchemaNotMigratedError(RuntimeError):
    """El esquema no está en la revisión que espera este código."""


async def _verify_schema_is_current() -> None:
    """Detiene el arranque si las migraciones no se han aplicado.

    Las aplica ``scripts/migrate.py`` antes de arrancar, no la aplicación.

    Antes esto sólo avisaba, para no arriesgar un bucle de arranque. Fue un
    error: sin el esquema, el arranque se cae igual unos pasos mas adelante al
    consultar `app_settings`, con un `UndefinedTableError` que no dice qué
    hacer y que ademas sepulta el aviso bajo su traza. Si va a morir de todas
    formas, que muera diciendo por qué, en la última línea del log.
    """
    try:
        async with get_engine().connect() as connection:
            current = (await connection.execute(text(
                "SELECT version_num FROM public.alembic_version"
            ))).scalar()
    except (OSError, SQLAlchemyError):
        raise SchemaNotMigratedError(
            "La base no tiene tabla alembic_version: falta aplicar las "
            "migraciones. Ejecutar:\n"
            "    docker compose exec -T backend python -m scripts.migrate"
        ) from None

    head = _alembic_head()
    if head and current != head:
        raise SchemaNotMigratedError(
            f"El esquema está en la revisión {current} y este código espera "
            f"{head}. Ejecutar:\n"
            "    docker compose exec -T backend python -m scripts.migrate"
        )
    if head and settings.multitenancy_enabled:
        await _verify_active_tenant_schemas(head)


async def _verify_active_tenant_schemas(head: str) -> None:
    """Comprueba registro y alembic_version real de cada tenant activo."""

    try:
        async with get_engine().connect() as connection:
            rows = (
                await connection.execute(
                    text(
                        "SELECT o.id, o.schema_name, v.revision, v.migration_status "
                        "FROM public.organizations o "
                        "LEFT JOIN public.tenant_schema_versions v "
                        "  ON v.organization_id = o.id "
                        "WHERE o.status = 'active' ORDER BY o.id"
                    )
                )
            ).mappings().all()
            for row in rows:
                schema_name = validate_schema_name(row["schema_name"])
                if row["revision"] != head or row["migration_status"] != "current":
                    raise SchemaNotMigratedError(
                        f"El tenant {row['id']} no está marcado en la revisión {head}. "
                        "Ejecutar scripts.migrate antes de arrancar."
                    )
                quoted = connection.dialect.identifier_preparer.quote(schema_name)
                actual = (
                    await connection.execute(
                        text(f"SELECT version_num FROM {quoted}.alembic_version")
                    )
                ).scalar_one_or_none()
                if actual != head:
                    raise SchemaNotMigratedError(
                        f"El schema del tenant {row['id']} está en {actual or 'ninguna'} "
                        f"y este código espera {head}. Ejecutar scripts.migrate."
                    )
    except SchemaNotMigratedError:
        raise
    except (OSError, SQLAlchemyError, ValueError):
        raise SchemaNotMigratedError(
            "No se pudo validar la versión de todos los tenants activos. "
            "Ejecutar scripts.migrate antes de arrancar."
        ) from None


def _alembic_head() -> str | None:
    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory
        from pathlib import Path

        base = Path(__file__).resolve().parent.parent
        config = Config(str(base / "alembic.ini"))
        config.set_main_option("script_location", str(base / "alembic"))
        return ScriptDirectory.from_config(config).get_current_head()
    except Exception:  # noqa: BLE001 - la comprobación nunca debe tumbar el arranque
        return None


async def _log_database_encryption() -> None:
    """Deja constancia en el log de si la conexión a PostgreSQL va cifrada.

    Con DATABASE_SSL="prefer" el cliente cae a texto plano sin avisar cuando
    el servidor no acepta TLS, que es la situación actual. Preguntarle al
    propio servidor evita que ese estado quede invisible.
    """
    try:
        async with get_engine().connect() as connection:
            row = (await connection.execute(text(
                "SELECT ssl, version FROM pg_stat_ssl WHERE pid = pg_backend_pid()"
            ))).first()
    except (OSError, SQLAlchemyError) as exc:
        logger.warning("No se pudo verificar el cifrado de la conexión (%s)", type(exc).__name__)
        return

    if row is not None and row[0]:
        logger.info("Conexión a PostgreSQL cifrada (%s)", row[1])
    else:
        logger.warning(
            "Conexión a PostgreSQL SIN CIFRAR (DATABASE_SSL=%s). Las credenciales "
            "y el contenido de los mensajes viajan en claro. Habilitar ssl=on en "
            "el servidor y subir DATABASE_SSL a 'require'.",
            settings.database_ssl,
        )


async def _detect_search_capabilities() -> None:
    """Comprueba si `f_unaccent` está disponible, sin crear nada.

    La función y sus índices los instala ahora la migración base. Aquí sólo se
    consulta, porque el resultado decide en caliente si las búsquedas usan
    f_unaccent o degradan a ILIKE sensible a acentos: sin esta detección, una
    base donde la extensión no pudo instalarse haría fallar cada búsqueda.
    """
    try:
        async with get_engine().connect() as connection:
            available = bool((await connection.execute(text(
                "SELECT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'f_unaccent')"
            ))).scalar())
    except (OSError, SQLAlchemyError) as exc:
        logger.warning(
            "No se pudo comprobar f_unaccent (%s); la búsqueda asumirá que no "
            "está disponible", type(exc).__name__,
        )
        available = False

    set_unaccent_enabled(available)
    if not available:
        logger.warning(
            "f_unaccent no está disponible: la búsqueda será sensible a "
            "acentos. Aplicar backend/migrations/020_search_unaccent.sql con "
            "un usuario con permisos para crear extensiones."
        )


async def _require_inbound_webhook_token() -> None:
    """Impide arrancar sin token de webhook entrante.

    `/api/webhooks/*` y la subida de media están expuestos a Internet y sólo
    los protege ese token. Con el valor vacío que traía backend/.env.example,
    `verify_webhook_token` dejaba pasar cualquier petición.

    La comprobación es aquí y no en `config.py` porque el token también puede
    vivir cifrado en `public.platform_settings`, así que hace falta la base de
    datos para saber si está configurado de verdad.

    Falla el arranque a propósito: en blue-green eso deja el color viejo
    sirviendo y el despliegue no promociona, que es preferible a promocionar
    una versión con los webhooks abiertos.
    """
    expected = await platform_setting("inbound_webhook_token")
    if expected.strip():
        return
    raise RuntimeError(
        "INBOUND_WEBHOOK_TOKEN no está configurado. Los webhooks entrantes y la "
        "subida de media quedarían abiertos a Internet. Generá uno con "
        "`openssl rand -hex 32`, ponelo en backend/.env o en Plataforma y "
        "configurá el mismo valor en n8n."
    )


async def _check_media_persistence() -> None:
    """Avisa o falla según el almacenamiento multimedia configurado.

    Con backend "minio" valida la configuración ahora, en vez de descubrir que
    faltaba una credencial en la primera subida de un usuario.

    Con backend "local" los archivos van a `backend/media` dentro del
    contenedor. Si esa ruta no está montada desde el host, cada despliegue
    blue-green levanta un contenedor nuevo y se lleva por delante todo lo
    subido. compose.prod.yml ya monta `./data/media`, pero el aviso queda para
    quien despliegue con otra topología.
    """
    backend = storage_backend()
    if backend == "minio":
        from app.integrations.storage.media_storage import validate_minio_config

        validate_minio_config()
        logger.info("Almacenamiento multimedia: MinIO (bucket %s)", settings.minio_bucket)
        return

    from app.integrations.storage.media_storage import MEDIA_DIR

    logger.warning(
        "MEDIA_STORAGE_BACKEND=local: los archivos se guardan en %s, dentro del "
        "contenedor. Si esa ruta no está montada desde el host, cada despliegue "
        "borra el multimedia subido. Usar MEDIA_STORAGE_BACKEND=minio en producción.",
        MEDIA_DIR,
    )


async def prepare() -> None:
    """Todo lo que tiene que estar listo antes de atender o de trabajar."""
    # El esquema ya no se toca aquí: lo aplica scripts/migrate.py bajo un
    # advisory lock, antes de que arranque cualquier proceso.
    await _wait_for_database()
    await _log_database_encryption()
    await _verify_schema_is_current()
    await _detect_search_capabilities()

    if settings.multitenancy_enabled:
        for context in await list_active_tenants():
            with tenant_context(context):
                encrypted_settings, decrypted_settings = await migrate_settings_encryption()
                if encrypted_settings or decrypted_settings:
                    logger.info(
                        "Configuración tenant normalizada organization_id=%s: "
                        "secretos_cifrados=%s públicos_descifrados=%s",
                        context.organization_id,
                        encrypted_settings,
                        decrypted_settings,
                    )
                await backfill_automation_state()
    else:
        encrypted_settings, decrypted_settings = await migrate_settings_encryption()
        if encrypted_settings or decrypted_settings:
            logger.info(
                "Configuración persistida normalizada: secretos_cifrados=%s "
                "públicos_descifrados=%s",
                encrypted_settings,
                decrypted_settings,
            )
        migrated_platform_settings = await migrate_legacy_platform_settings()
        if migrated_platform_settings:
            logger.info(
                "Configuración global legacy migrada a plataforma: claves=%s",
                migrated_platform_settings,
            )
        await backfill_automation_state()

    # Después de migrar el esquema: el token puede vivir cifrado en el plano de
    # plataforma y no en el entorno.
    await _require_inbound_webhook_token()
    await _check_media_persistence()

    if (
        not settings.multitenancy_enabled
        and settings.admin_email
        and settings.admin_password
    ):
        await seed_admin_if_needed(settings.admin_email.strip().lower(), hash_password(settings.admin_password))


# Lo que depende de este proceso: sus conexiones WebSocket y su /metrics.
API_LOOPS = (
    TenantLoop("task-reminders", deliver_due_reminders, sleeping(30.0)),
    TenantLoop("queue-metrics", queue_metrics_tick, sleeping(METRICS_POLL_SECONDS)),
)

# El trabajo de fondo, que puede vivir en un proceso aparte.
BACKGROUND_LOOPS = (
    TenantLoop("chat-watcher", chat_watcher_tick, sleeping(POLL_INTERVAL_SECONDS)),
    TenantLoop("automations", automations_tick, wait_for_automation_work),
    TenantLoop("message-outbox", outbox_tick, wait_for_outbox_work),
    TenantLoop("scheduled-messages", scheduled_tick, sleeping(SCHEDULED_POLL_SECONDS)),
)


def start_background(*, api: bool, workers: bool) -> list[asyncio.Task]:
    tenants = CachedTenants() if settings.multitenancy_enabled else single_tenant
    loops = (API_LOOPS if api else ()) + (BACKGROUND_LOOPS if workers else ())
    tasks = [asyncio.create_task(run_bus(), name="signal-bus")]
    tasks += [asyncio.create_task(run_tenant_loop(loop, tenants), name=loop.name) for loop in loops]
    if workers:
        # El inbox de Meta vive en el plano de control: un solo ciclo para
        # toda la plataforma, que abre el contexto de cada negocio por evento.
        tasks.append(asyncio.create_task(watch_meta_webhook_inbox(), name="meta-webhook-inbox"))
    return tasks


async def stop_background(tasks: list[asyncio.Task]) -> None:
    for task in tasks:
        task.cancel()
    for task in tasks:
        with contextlib.suppress(asyncio.CancelledError):
            await task
    await close_meta_client()
    await close_n8n_client()
    await close_tts_client()
    await close_engine()
