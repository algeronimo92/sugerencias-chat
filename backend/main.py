import asyncio
import contextlib
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from config import settings
from db.session import close_engine
from routers import chats, media, suggestions, webhooks
from routers.media import MEDIA_DIR
from services.chat_watcher import watch_chats
from services.ws_manager import manager


@asynccontextmanager
async def lifespan(app: FastAPI):
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
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(chats.router)
app.include_router(suggestions.router)
app.include_router(webhooks.router)
app.include_router(media.router)

app.mount("/media", StaticFiles(directory=str(MEDIA_DIR)), name="media")


@app.websocket("/ws/chats")
async def chats_websocket(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        await manager.disconnect(websocket)


@app.get("/health")
async def health():
    return {"status": "ok"}
