import asyncio
import contextlib
import logging
from time import perf_counter
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from fastapi import Depends, FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncConnection
from config import settings
from db.models import Base
from db.session import close_engine, get_engine
from routers import auth, automations, chats, dashboard, internal_notes, media, media_library, notifications, scheduled_messages, settings as settings_router, suggestions, tags, tasks, templates, tts, users, webhooks, whatsapp
from services.auth_service import COOKIE_NAME, get_current_user, get_user_from_token, hash_password, require_admin
from services.chat_watcher import watch_chats
from services.db_service import seed_admin_if_needed, set_unaccent_enabled
from services.ws_manager import manager
from services.task_reminder import watch_task_reminders
from services.automation_service import backfill_automation_state, watch_automations
from services.evolution_service import close_evolution_client
from services.n8n_service import close_n8n_client
from services.tts_service import close_tts_client
from services.message_outbox import watch_message_outbox
from services.scheduled_message_service import watch_scheduled_messages
from services.performance import begin_request_metrics, finish_request_metrics
from services.media_storage import MediaStorageError, check_media_storage
from services.settings_service import migrate_settings_encryption

logger = logging.getLogger(__name__)
DATABASE_RETRY_MAX_SECONDS = 30


async def _begin_database_transaction_with_retry(
) -> tuple[AbstractAsyncContextManager[AsyncConnection], AsyncConnection]:
    attempt = 0
    while True:
        attempt += 1
        transaction = get_engine().begin()
        try:
            connection = await transaction.__aenter__()
            if attempt > 1:
                logger.info("Database connection recovered after %s attempts", attempt)
            return transaction, connection
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


async def _column_exists(conn: AsyncConnection, table: str, column: str) -> bool:
    result = await conn.execute(text(
        "SELECT EXISTS (SELECT 1 FROM information_schema.columns "
        "WHERE table_schema = current_schema() AND table_name = :table "
        "AND column_name = :column)"
    ), {"table": table, "column": column})
    return bool(result.scalar())


async def _index_exists(conn: AsyncConnection, index: str) -> bool:
    result = await conn.execute(text(
        "SELECT EXISTS (SELECT 1 FROM pg_indexes "
        "WHERE schemaname = current_schema() AND indexname = :index)"
    ), {"index": index})
    return bool(result.scalar())


async def _constraint_exists(conn: AsyncConnection, constraint: str) -> bool:
    result = await conn.execute(text(
        "SELECT EXISTS (SELECT 1 FROM pg_constraint "
        "WHERE conname = :constraint AND connamespace = current_schema()::regnamespace)"
    ), {"constraint": constraint})
    return bool(result.scalar())


async def _add_column_if_missing(
    conn: AsyncConnection,
    table: str,
    column: str,
    definition: str,
) -> None:
    if not await _column_exists(conn, table, column):
        await conn.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{column}" {definition}'))


async def _create_index_if_missing(
    conn: AsyncConnection,
    index: str,
    statement: str,
) -> None:
    if not await _index_exists(conn, index):
        await conn.execute(text(statement))


async def _setup_search_unaccent() -> None:
    """Migración 020 aplicada al arrancar: búsqueda insensible a acentos.

    En transacción propia: si el usuario de la base (externa) no puede crear
    extensiones, la búsqueda degrada a ILIKE sin unaccent en vez de romper
    el startup o dejar la transacción principal abortada.
    """
    try:
        async with get_engine().begin() as conn:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS unaccent"))
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS pg_trgm"))
            await conn.execute(text(
                "CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text AS "
                "$$ SELECT public.unaccent('public.unaccent', $1) $$ "
                "LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT"
            ))
            await _create_index_if_missing(
                conn, "idx_wsp_messages_content_trgm",
                "CREATE INDEX idx_wsp_messages_content_trgm "
                "ON wsp_messages USING gin (f_unaccent(content) gin_trgm_ops)",
            )
            await _create_index_if_missing(
                conn, "idx_leads_nombre_trgm",
                "CREATE INDEX idx_leads_nombre_trgm "
                "ON leads USING gin (f_unaccent(nombre) gin_trgm_ops)",
            )
        set_unaccent_enabled(True)
    except (OSError, SQLAlchemyError) as exc:
        set_unaccent_enabled(False)
        logger.warning(
            "No se pudo habilitar unaccent (%s); la búsqueda seguirá siendo "
            "sensible a acentos. Aplicar backend/migrations/020_search_unaccent.sql "
            "con un usuario con permisos.",
            type(exc).__name__,
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    # create_all no toca las tablas ya existentes (leads, wsp_messages, que
    # vienen de la DB externa) — solo crea las que falten, como app_settings/users.
    database_transaction, conn = await _begin_database_transaction_with_retry()
    try:
        await conn.run_sync(Base.metadata.create_all)
        # create_all no altera tablas existentes. Esta migración idempotente
        # permite actualizar instalaciones que ya tenían lead_tasks.
        await _add_column_if_missing(conn, "lead_tasks", "reminder_sent_at", "TIMESTAMPTZ")
        await _add_column_if_missing(conn, "leads", "vendedor_id", "INTEGER")
        # wsp_messages es una tabla externa ya existente; create_all no puede
        # agregar estas columnas, necesarias para relacionar MESSAGES_UPDATE.
        await _add_column_if_missing(conn, "wsp_messages", "wa_message_id", "TEXT")
        await _add_column_if_missing(conn, "wsp_messages", "status", "TEXT")
        # Dimensiones de imágenes para que el chat reserve el espacio exacto;
        # se rellenan de forma perezosa al servir cada página de mensajes.
        await _add_column_if_missing(conn, "wsp_messages", "media_width", "INTEGER")
        await _add_column_if_missing(conn, "wsp_messages", "media_height", "INTEGER")
        await _add_column_if_missing(conn, "message_templates", "visibility", "TEXT NOT NULL DEFAULT 'global'")
        await _add_column_if_missing(conn, "message_templates", "template_type", "TEXT NOT NULL DEFAULT 'internal'")
        await _add_column_if_missing(conn, "message_templates", "official_name", "TEXT")
        await _add_column_if_missing(conn, "message_templates", "official_language", "TEXT")
        await _add_column_if_missing(conn, "message_templates", "official_category", "TEXT")
        await _add_column_if_missing(conn, "message_templates", "official_status", "TEXT")
        await _add_column_if_missing(conn, "message_templates", "official_parameter_values", "JSONB NOT NULL DEFAULT '[]'::jsonb")
        await _add_column_if_missing(conn, "message_templates", "interactive_type", "TEXT NOT NULL DEFAULT 'none'")
        await _add_column_if_missing(conn, "message_templates", "interactive_config", "JSONB NOT NULL DEFAULT '{}'::jsonb")
        await _add_column_if_missing(conn, "automation_rules", "builder_mode", "TEXT NOT NULL DEFAULT 'simple'")
        await _add_column_if_missing(conn, "automation_rules", "flow_definition", "JSONB NOT NULL DEFAULT '{}'::jsonb")
        await _add_column_if_missing(conn, "automation_rules", "published_flow_definition", "JSONB")
        await _add_column_if_missing(conn, "automation_rules", "flow_version", "INTEGER NOT NULL DEFAULT 0")
        await _add_column_if_missing(conn, "automation_executions", "flow_state", "JSONB NOT NULL DEFAULT '{}'::jsonb")
        await _add_column_if_missing(conn, "automation_executions", "attempts", "INTEGER NOT NULL DEFAULT 0")
        await _add_column_if_missing(conn, "automation_rules", "max_executions_per_hour", "INTEGER")
        await _create_index_if_missing(
            conn, "idx_automation_rules_builder_mode",
            "CREATE INDEX idx_automation_rules_builder_mode ON automation_rules(builder_mode, is_active)",
        )
        # Las queries de discovery de automatizaciones filtran por rango de
        # tiempo — sin estos índices son full scans cada ciclo del watcher.
        await _create_index_if_missing(
            conn, "idx_wsp_messages_sent_at",
            "CREATE INDEX idx_wsp_messages_sent_at ON wsp_messages(sent_at)",
        )
        await _create_index_if_missing(
            conn, "idx_wsp_messages_wa_message_id",
            "CREATE INDEX idx_wsp_messages_wa_message_id "
            "ON wsp_messages(wa_message_id) WHERE wa_message_id IS NOT NULL",
        )
        await _create_index_if_missing(
            conn, "idx_lead_tasks_due_pending",
            "CREATE INDEX idx_lead_tasks_due_pending "
            "ON lead_tasks(due_at) WHERE status = 'pending'",
        )
        await _create_index_if_missing(
            conn, "idx_message_templates_type_status",
            "CREATE INDEX idx_message_templates_type_status ON message_templates(template_type, official_status, is_active)",
        )
        await _create_index_if_missing(
            conn, "idx_message_templates_interactive_type",
            "CREATE INDEX idx_message_templates_interactive_type ON message_templates(interactive_type, is_active)",
        )
        if await _constraint_exists(conn, "message_templates_shortcut_key"):
            await conn.execute(text("ALTER TABLE message_templates DROP CONSTRAINT message_templates_shortcut_key"))
        if await _index_exists(conn, "uq_message_templates_shortcut_lower"):
            await conn.execute(text("DROP INDEX uq_message_templates_shortcut_lower"))
        await _create_index_if_missing(
            conn, "uq_templates_global_shortcut_lower",
            "CREATE UNIQUE INDEX uq_templates_global_shortcut_lower "
            "ON message_templates(lower(shortcut)) WHERE visibility = 'global' AND shortcut IS NOT NULL",
        )
        await _create_index_if_missing(
            conn, "uq_templates_personal_shortcut_owner",
            "CREATE UNIQUE INDEX uq_templates_personal_shortcut_owner "
            "ON message_templates(created_by_user_id, lower(shortcut)) "
            "WHERE visibility = 'personal' AND shortcut IS NOT NULL",
        )
        await _create_index_if_missing(
            conn, "idx_leads_vendedor_id",
            "CREATE INDEX idx_leads_vendedor_id ON leads(vendedor_id)",
        )
        has_lead_seller_fk = (
            await _constraint_exists(conn, "fk_leads_vendedor_id_users")
            or await _constraint_exists(conn, "leads_vendedor_id_fkey")
        )
        if not has_lead_seller_fk:
            await conn.execute(text(
                "ALTER TABLE leads ADD CONSTRAINT fk_leads_vendedor_id_users "
                "FOREIGN KEY (vendedor_id) REFERENCES users(id) ON DELETE SET NULL"
            ))
        # Vincula automáticamente textos históricos cuyo nombre coincide con
        # un único usuario activo. Los no coincidentes permanecen visibles
        # mediante el fallback a la columna vendedor.
        await conn.execute(text(
            "UPDATE leads l SET vendedor_id = matched.id FROM ("
            "SELECT lower(trim(name)) AS normalized_name, min(id) AS id "
            "FROM users WHERE is_active = true GROUP BY lower(trim(name)) HAVING count(*) = 1"
            ") matched WHERE l.vendedor_id IS NULL AND l.vendedor IS NOT NULL "
            "AND lower(trim(l.vendedor)) = matched.normalized_name"
        ))
        await _create_index_if_missing(
            conn, "idx_lead_tasks_pending_reminder",
            "CREATE INDEX idx_lead_tasks_pending_reminder "
            "ON lead_tasks(remind_at) WHERE status = 'pending' AND reminder_sent_at IS NULL",
        )
        await _add_column_if_missing(conn, "template_attachments", "library_asset_id", "INTEGER")
        if not await _constraint_exists(conn, "template_attachments_library_asset_id_fkey"):
            await conn.execute(text(
                "ALTER TABLE template_attachments ADD CONSTRAINT template_attachments_library_asset_id_fkey "
                "FOREIGN KEY (library_asset_id) REFERENCES media_assets(id) ON DELETE RESTRICT"
            ))
        await _create_index_if_missing(
            conn, "idx_template_attachments_library_asset",
            "CREATE INDEX idx_template_attachments_library_asset ON template_attachments(library_asset_id)",
        )
        # Los adjuntos creados antes de la biblioteca también pasan a estar
        # disponibles para reutilizarlos, sin duplicar el archivo físico.
        await conn.execute(text(
            "INSERT INTO media_assets "
            "(media_url, content_type, filename, size_bytes, uploaded_by_user_id, created_at) "
            "SELECT media_url, min(content_type), min(filename), 0, NULL, min(created_at) "
            "FROM template_attachments GROUP BY media_url "
            "ON CONFLICT (media_url) DO NOTHING"
        ))
        await conn.execute(text(
            "UPDATE template_attachments ta SET library_asset_id = ma.id "
            "FROM media_assets ma WHERE ta.library_asset_id IS NULL "
            "AND ma.media_url = ta.media_url"
        ))
        await _add_column_if_missing(conn, "lead_note_mentions", "read_at", "TIMESTAMPTZ")
        await conn.execute(text(
            "INSERT INTO user_notifications "
            "(user_id, notification_type, title, body, lead_id, source_id, metadata, read_at, created_at) "
            "SELECT m.user_id, 'internal_note_mention', u.name || ' te mencionó en una nota', "
            "n.content, n.lead_id, n.id::text, "
            "jsonb_build_object('note_id', n.id, 'author_user_id', u.id, 'author_name', u.name), "
            "m.read_at, m.created_at FROM lead_note_mentions m "
            "JOIN lead_notes n ON n.id = m.note_id JOIN users u ON u.id = n.author_user_id "
            "WHERE m.user_id <> n.author_user_id AND NOT EXISTS ("
            "SELECT 1 FROM user_notifications un WHERE un.user_id = m.user_id "
            "AND un.notification_type = 'internal_note_mention' AND un.source_id = n.id::text)"
        ))
    except BaseException as exc:
        await database_transaction.__aexit__(type(exc), exc, exc.__traceback__)
        raise
    else:
        await database_transaction.__aexit__(None, None, None)

    await _setup_search_unaccent()

    encrypted_settings, decrypted_settings = await migrate_settings_encryption()
    if encrypted_settings or decrypted_settings:
        logger.info(
            "Normalized persisted application settings: encrypted_secrets=%s "
            "decrypted_public=%s",
            encrypted_settings,
            decrypted_settings,
        )

    if settings.admin_email and settings.admin_password:
        await seed_admin_if_needed(settings.admin_email.strip().lower(), hash_password(settings.admin_password))

    await backfill_automation_state()

    watcher_task = asyncio.create_task(watch_chats())
    reminder_task = asyncio.create_task(watch_task_reminders())
    automation_task = asyncio.create_task(watch_automations())
    outbox_task = asyncio.create_task(watch_message_outbox())
    scheduled_messages_task = asyncio.create_task(watch_scheduled_messages())
    yield
    watcher_task.cancel()
    reminder_task.cancel()
    automation_task.cancel()
    outbox_task.cancel()
    scheduled_messages_task.cancel()
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
    await close_evolution_client()
    await close_n8n_client()
    await close_tts_client()
    await close_engine()


app = FastAPI(title="WSP Suggestions API", lifespan=lifespan)


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
app.include_router(webhooks.router)
app.include_router(media.router)
app.include_router(media.files_router)


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
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)
