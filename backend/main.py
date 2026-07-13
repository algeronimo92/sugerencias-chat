import asyncio
import contextlib
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from config import settings
from db.models import Base
from db.session import close_engine, get_engine
from routers import auth, chats, media, settings as settings_router, suggestions, tags, tts, users, webhooks
from routers.media import MEDIA_DIR
from services.auth_service import COOKIE_NAME, decode_access_token, get_current_user, hash_password, require_admin
from services.chat_watcher import watch_chats
from services.db_service import get_user_by_id, seed_admin_if_needed
from services.ws_manager import manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    # create_all no toca las tablas ya existentes (leads, wsp_messages, que
    # vienen de la DB externa) — solo crea las que falten, como app_settings/users.
    async with get_engine().begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    if settings.admin_email and settings.admin_password:
        await seed_admin_if_needed(settings.admin_email.strip().lower(), hash_password(settings.admin_password))

    watcher_task = asyncio.create_task(watch_chats())
    yield
    watcher_task.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await watcher_task
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

    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(websocket)


@app.get("/health")
async def health():
    return {"status": "ok"}
