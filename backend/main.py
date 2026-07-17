import asyncio
import contextlib
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import text
from config import settings
from db.models import Base
from db.session import close_engine, get_engine
from routers import auth, automations, chats, dashboard, internal_notes, media, media_library, notifications, settings as settings_router, suggestions, tags, tasks, templates, tts, users, webhooks
from routers.media import MEDIA_DIR
from services.auth_service import COOKIE_NAME, decode_access_token, get_current_user, hash_password, require_admin
from services.chat_watcher import watch_chats
from services.db_service import get_user_by_id, seed_admin_if_needed
from services.ws_manager import manager
from services.task_reminder import watch_task_reminders
from services.automation_service import backfill_automation_state, watch_automations


@asynccontextmanager
async def lifespan(app: FastAPI):
    # create_all no toca las tablas ya existentes (leads, wsp_messages, que
    # vienen de la DB externa) — solo crea las que falten, como app_settings/users.
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # create_all no altera tablas existentes. Esta migración idempotente
        # permite actualizar instalaciones que ya tenían lead_tasks.
        await conn.execute(text("ALTER TABLE lead_tasks ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ"))
        await conn.execute(text("ALTER TABLE leads ADD COLUMN IF NOT EXISTS vendedor_id INTEGER"))
        await conn.execute(text("ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'global'"))
        await conn.execute(text("ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS template_type TEXT NOT NULL DEFAULT 'internal'"))
        await conn.execute(text("ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS official_name TEXT"))
        await conn.execute(text("ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS official_language TEXT"))
        await conn.execute(text("ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS official_category TEXT"))
        await conn.execute(text("ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS official_status TEXT"))
        await conn.execute(text("ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS official_parameter_values JSONB NOT NULL DEFAULT '[]'::jsonb"))
        await conn.execute(text("ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS interactive_type TEXT NOT NULL DEFAULT 'none'"))
        await conn.execute(text("ALTER TABLE message_templates ADD COLUMN IF NOT EXISTS interactive_config JSONB NOT NULL DEFAULT '{}'::jsonb"))
        await conn.execute(text("ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS builder_mode TEXT NOT NULL DEFAULT 'simple'"))
        await conn.execute(text("ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS flow_definition JSONB NOT NULL DEFAULT '{}'::jsonb"))
        await conn.execute(text("ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS published_flow_definition JSONB"))
        await conn.execute(text("ALTER TABLE automation_rules ADD COLUMN IF NOT EXISTS flow_version INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(text("ALTER TABLE automation_executions ADD COLUMN IF NOT EXISTS flow_state JSONB NOT NULL DEFAULT '{}'::jsonb"))
        await conn.execute(text("ALTER TABLE automation_executions ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0"))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_automation_rules_builder_mode ON automation_rules(builder_mode, is_active)"))
        # Las queries de discovery de automatizaciones filtran por rango de
        # tiempo — sin estos índices son full scans cada ciclo del watcher.
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_wsp_messages_sent_at ON wsp_messages(sent_at)"))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_lead_tasks_due_pending "
            "ON lead_tasks(due_at) WHERE status = 'pending'"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_message_templates_type_status "
            "ON message_templates(template_type, official_status, is_active)"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_message_templates_interactive_type "
            "ON message_templates(interactive_type, is_active)"
        ))
        await conn.execute(text("ALTER TABLE message_templates DROP CONSTRAINT IF EXISTS message_templates_shortcut_key"))
        await conn.execute(text("DROP INDEX IF EXISTS uq_message_templates_shortcut_lower"))
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_templates_global_shortcut_lower "
            "ON message_templates(lower(shortcut)) WHERE visibility = 'global' AND shortcut IS NOT NULL"
        ))
        await conn.execute(text(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_templates_personal_shortcut_owner "
            "ON message_templates(created_by_user_id, lower(shortcut)) "
            "WHERE visibility = 'personal' AND shortcut IS NOT NULL"
        ))
        await conn.execute(text("CREATE INDEX IF NOT EXISTS idx_leads_vendedor_id ON leads(vendedor_id)"))
        await conn.execute(text(
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint "
            "WHERE conname IN ('fk_leads_vendedor_id_users', 'leads_vendedor_id_fkey')) THEN "
            "ALTER TABLE leads ADD CONSTRAINT fk_leads_vendedor_id_users "
            "FOREIGN KEY (vendedor_id) REFERENCES users(id) ON DELETE SET NULL; "
            "END IF; END $$"
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
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_lead_tasks_pending_reminder "
            "ON lead_tasks(remind_at) WHERE status = 'pending' AND reminder_sent_at IS NULL"
        ))
        await conn.execute(text(
            "ALTER TABLE template_attachments "
            "ADD COLUMN IF NOT EXISTS library_asset_id INTEGER"
        ))
        await conn.execute(text(
            "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint "
            "WHERE conname = 'template_attachments_library_asset_id_fkey') THEN "
            "ALTER TABLE template_attachments ADD CONSTRAINT template_attachments_library_asset_id_fkey "
            "FOREIGN KEY (library_asset_id) REFERENCES media_assets(id) ON DELETE RESTRICT; "
            "END IF; END $$"
        ))
        await conn.execute(text(
            "CREATE INDEX IF NOT EXISTS idx_template_attachments_library_asset "
            "ON template_attachments(library_asset_id)"
        ))
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
        await conn.execute(text(
            "ALTER TABLE lead_note_mentions "
            "ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ"
        ))
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

    if settings.admin_email and settings.admin_password:
        await seed_admin_if_needed(settings.admin_email.strip().lower(), hash_password(settings.admin_password))

    await backfill_automation_state()

    watcher_task = asyncio.create_task(watch_chats())
    reminder_task = asyncio.create_task(watch_task_reminders())
    automation_task = asyncio.create_task(watch_automations())
    yield
    watcher_task.cancel()
    reminder_task.cancel()
    automation_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await watcher_task
    with contextlib.suppress(asyncio.CancelledError):
        await reminder_task
    with contextlib.suppress(asyncio.CancelledError):
        await automation_task
    await close_engine()


app = FastAPI(title="WSP Suggestions API", lifespan=lifespan)

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
app.include_router(tags.router)
app.include_router(tasks.router)
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

app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")


@app.websocket("/ws/chats")
async def chats_websocket(websocket: WebSocket):
    token = websocket.cookies.get(COOKIE_NAME)
    user_id = decode_access_token(token) if token else None
    user = await get_user_by_id(user_id) if user_id is not None else None
    if user is None or not user.is_active:
        await websocket.close(code=4401)
        return

    await manager.connect(websocket, user.id)
    await websocket.send_json({"type": "notifications_updated"})
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(websocket)


@app.get("/health")
async def health():
    return {"status": "ok"}
