import asyncio
import contextlib
import json
import logging
from time import perf_counter
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from config import settings
from db.session import close_engine, get_engine
from routers import auth, automations, chats, dashboard, internal_notes, lead_services, media, media_library, notifications, scheduled_messages, settings as settings_router, suggestions, tags, tasks, templates, tts, users, webhooks, whatsapp
from services.auth_service import COOKIE_NAME, get_current_user, get_user_from_token, hash_password, require_admin, verify_webhook_token
from services.chat_watcher import watch_chats
from services.db_service import seed_admin_if_needed, set_unaccent_enabled
from services.ws_manager import manager
from services.task_reminder import watch_task_reminders
from services.automation_service import backfill_automation_state, watch_automations
from services.evolution_service import close_evolution_client
from services.n8n_service import close_n8n_client
from services.tts_service import close_tts_client
from services.message_outbox import watch_message_outbox
from services.queue_metrics import watch_queue_metrics
from services.scheduled_message_service import watch_scheduled_messages
from services.performance import begin_request_metrics, finish_request_metrics
from services.media_storage import MediaStorageError, check_media_storage, storage_backend
from services.settings_service import get_effective, migrate_settings_encryption

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
                logger.info("Database connection recovered after %s attempts", attempt)
            return
        except (OSError, SQLAlchemyError) as exc:
            await close_engine()
            delay = min(2 ** (attempt - 1), DATABASE_RETRY_MAX_SECONDS)
            logger.warning(
                "Database unavailable during startup (attempt %s, %s); retrying in %ss",
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
                "SELECT version_num FROM alembic_version"
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


def _alembic_head() -> str | None:
    try:
        from alembic.config import Config
        from alembic.script import ScriptDirectory
        from pathlib import Path

        base = Path(__file__).resolve().parent
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
    venir de `app_settings` (es editable desde Configuración), así que hace
    falta la base de datos para saber si está configurado de verdad.

    Falla el arranque a propósito: en blue-green eso deja el color viejo
    sirviendo y el despliegue no promociona, que es preferible a promocionar
    una versión con los webhooks abiertos.
    """
    if (await get_effective("inbound_webhook_token")).strip():
        return
    raise RuntimeError(
        "INBOUND_WEBHOOK_TOKEN no está configurado. Los webhooks entrantes y la "
        "subida de media quedarían abiertos a Internet. Generá uno con "
        "`openssl rand -hex 32`, ponelo en backend/.env (o en Configuración) y "
        "configurá el mismo valor en n8n y en Evolution API."
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
        from services.media_storage import validate_minio_config

        validate_minio_config()
        logger.info("Almacenamiento multimedia: MinIO (bucket %s)", settings.minio_bucket)
        return

    from services.media_storage import MEDIA_DIR

    logger.warning(
        "MEDIA_STORAGE_BACKEND=local: los archivos se guardan en %s, dentro del "
        "contenedor. Si esa ruta no está montada desde el host, cada despliegue "
        "borra el multimedia subido. Usar MEDIA_STORAGE_BACKEND=minio en producción.",
        MEDIA_DIR,
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # El esquema ya no se toca aquí. Antes este bloque ejecutaba create_all
    # más una treintena de ALTER/CREATE INDEX y tres backfills de tabla
    # completa, en cada arranque y dentro de una sola transacción. Con más de
    # una instancia arrancando a la vez, dos procesos comprobaban "¿existe
    # este índice?", ambos respondían que no, y el segundo CREATE INDEX
    # reventaba. Ahora lo aplica scripts/migrate.py bajo un advisory lock,
    # antes de que arranque la aplicación.
    await _wait_for_database()
    await _log_database_encryption()
    await _verify_schema_is_current()
    await _detect_search_capabilities()

    encrypted_settings, decrypted_settings = await migrate_settings_encryption()
    if encrypted_settings or decrypted_settings:
        logger.info(
            "Normalized persisted application settings: encrypted_secrets=%s "
            "decrypted_public=%s",
            encrypted_settings,
            decrypted_settings,
        )

    # Después de normalizar app_settings: el token puede vivir ahí y no en el
    # entorno, así que antes de este punto la lectura daría un falso negativo.
    await _require_inbound_webhook_token()
    await _check_media_persistence()

    if settings.admin_email and settings.admin_password:
        await seed_admin_if_needed(settings.admin_email.strip().lower(), hash_password(settings.admin_password))

    await backfill_automation_state()

    watcher_task = asyncio.create_task(watch_chats())
    reminder_task = asyncio.create_task(watch_task_reminders())
    automation_task = asyncio.create_task(watch_automations())
    outbox_task = asyncio.create_task(watch_message_outbox())
    scheduled_messages_task = asyncio.create_task(watch_scheduled_messages())
    queue_metrics_task = asyncio.create_task(watch_queue_metrics())
    yield
    watcher_task.cancel()
    reminder_task.cancel()
    automation_task.cancel()
    outbox_task.cancel()
    scheduled_messages_task.cancel()
    queue_metrics_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await watcher_task
    with contextlib.suppress(asyncio.CancelledError):
        await reminder_task
    with contextlib.suppress(asyncio.CancelledError):
        await automation_task
    with contextlib.suppress(asyncio.CancelledError):
        await outbox_task
    with contextlib.suppress(asyncio.CancelledError):
        await scheduled_messages_task
    with contextlib.suppress(asyncio.CancelledError):
        await queue_metrics_task
    await close_evolution_client()
    await close_n8n_client()
    await close_tts_client()
    await close_engine()


app = FastAPI(title="WSP Suggestions API", lifespan=lifespan)

# Expone /metrics (histogramas por ruta/método) para Prometheus. Solo lo
# alcanza nginx desde loopback (ver frontend/nginx.conf) — nunca queda
# público a través de chat.dermicapro.app.
Instrumentator().instrument(app).expose(app)


@app.middleware("http")
async def add_performance_headers(request, call_next):
    tokens = begin_request_metrics()
    started_at = perf_counter()
    try:
        response = await call_next(request)
    except BaseException:
        finish_request_metrics(tokens)
        raise
    total_ms = (perf_counter() - started_at) * 1000
    metrics = finish_request_metrics(tokens)
    timings = [f"app;dur={total_ms:.1f}", f"db;dur={metrics.database_ms:.1f}"]
    timings.extend(f"{name};dur={duration:.1f}" for name, duration in metrics.external_ms.items())
    response.headers["Server-Timing"] = ", ".join(timings)
    response.headers["X-DB-Queries"] = str(metrics.query_count)
    if total_ms >= 1000:
        logger.info(
            "Slow request %s %s total=%.1fms db=%.1fms queries=%s external=%s",
            request.method, request.url.path, total_ms, metrics.database_ms,
            metrics.query_count, metrics.external_ms,
        )
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(chats.router, dependencies=[Depends(get_current_user)])
app.include_router(suggestions.router, dependencies=[Depends(get_current_user)])
app.include_router(tts.router, dependencies=[Depends(get_current_user)])
app.include_router(settings_router.router, dependencies=[Depends(require_admin)])
app.include_router(whatsapp.router, dependencies=[Depends(require_admin)])
app.include_router(tags.router)
app.include_router(lead_services.router)
app.include_router(tasks.router)
app.include_router(scheduled_messages.router)
app.include_router(templates.router)
app.include_router(media_library.router)
app.include_router(internal_notes.router)
app.include_router(notifications.router)
app.include_router(dashboard.router)
app.include_router(automations.router)
# webhooks y media.upload los llama n8n directamente (autenticados con su
# propio token, ver INBOUND_WEBHOOK_TOKEN) — no son sesiones de usuario.
app.include_router(webhooks.router, dependencies=[Depends(verify_webhook_token)])
app.include_router(media.router, dependencies=[Depends(verify_webhook_token)])
# /media/<archivo> sí es contenido de clientes (fotos, audios, documentos) y
# solo lo consume el navegador del vendedor. La cookie es SameSite=Lax y tanto
# dev como producción son same-site, así que <img>/<audio>/<video> la envían.
app.include_router(media.files_router, dependencies=[Depends(get_current_user)])


@app.get("/health", tags=["health"])
async def health():
    return {"status": "ok"}


@app.get("/health/ready", tags=["health"])
async def readiness():
    try:
        async with get_engine().connect() as connection:
            await connection.execute(text("SELECT 1"))
        storage = await asyncio.to_thread(check_media_storage)
    except MediaStorageError as exc:
        logger.warning("Storage health check failed: %s", exc)
        raise HTTPException(status_code=503, detail="Media storage unavailable") from exc
    except (OSError, SQLAlchemyError) as exc:
        logger.warning("Health check failed: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    return {"status": "ok", "database": "ok", "media_storage": storage["backend"]}


@app.websocket("/ws/chats")
async def chats_websocket(websocket: WebSocket):
    token = websocket.cookies.get(COOKIE_NAME)
    user = await get_user_from_token(token)
    if user is None:
        await websocket.close(code=4401)
        return

    await manager.connect(websocket, user.id)
    try:
        await websocket.send_json({"type": "notifications_updated"})
        while True:
            raw = await websocket.receive_text()
            # Heartbeat del cliente: se responde el ping con un pong para que su
            # watchdog confirme que la conexión sigue viva aunque no haya novedades.
            try:
                if json.loads(raw).get("type") == "ping":
                    await websocket.send_json({"type": "pong"})
            except (ValueError, AttributeError):
                pass
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)
