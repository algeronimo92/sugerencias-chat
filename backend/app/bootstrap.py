"""Compone FastAPI, rutas, middleware y workers de la aplicación."""

import asyncio
import json
import logging
import uuid
from time import perf_counter
from contextlib import asynccontextmanager
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from prometheus_fastapi_instrumentator import Instrumentator
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

# Debe ejecutarse antes que cualquier otro import registre un logger con la
# configuración por defecto de logging (texto plano sin estructura): esto
# reemplaza esa configuración por JSON estructurado a stdout, lo que
# lee Loki (ver logging_config.py). Va antes incluso de `from app.core.config import
# settings` para cubrir cualquier log que se dispare a nivel de import.
from app.core.logging_config import configure_logging

configure_logging()

from app.core.config import settings
from app.core.errors import DomainError
from app.composition import configure as configure_composition
from app.db.session import get_engine
from app.modules.issue_reports import api as issue_reports
from app.modules.appointments import api as appointments
from app.modules.catalogs import custom_fields_api as custom_fields, services_api as lead_services, tags_api as tags, template_categories_api as template_categories
from app.modules.leads import stages_api as lead_stages
from app.modules.leads.dashboard import api as dashboard
from app.modules.tasks import api as tasks
from app.integrations.meta_webhook import api as meta_webhook
from app.modules.ai import assistant_api as ai_assistant, suggestions_api as suggestions
from app.modules.auth import api as auth, users_api as users
from app.modules.automations import api as automations
from app.modules.platform import api as platform
from app.modules.conversations import api as chats
from app.modules.leads import api as lead_routes
from app.integrations.n8n import api as webhooks
from app.modules.platform import branding_api as branding
from app.modules.conversations import internal_notes_api as internal_notes
from app.modules.media import api as media
from app.modules.media import library_api as media_library
from app.modules.notifications import api as notifications
from app.modules.notifications import push_api as push
from app.modules.conversations import scheduled_messages_api as scheduled_messages
from app.modules.platform import settings_api as settings_router
from app.modules.platform import google_calendar_api as google_calendar
from app.modules.catalogs import templates_api as templates
from app.modules.ai import tts_api as tts
from app.modules.platform import whatsapp_api as whatsapp
from app.modules.auth.auth_service import COOKIE_NAME, get_current_user, get_user_from_token, require_admin, verify_webhook_token, websocket_origin_allowed
from app.realtime.ws_manager import manager
from app.core.request_metrics import begin_request_metrics, finish_request_metrics
from app.core.request_context import reset_request_id, set_request_id
from app.integrations.storage.media_storage import MediaStorageError, check_media_storage
from app.tenancy.middleware import TenantResolutionMiddleware
from app.tenancy.dependencies import bind_integration_tenant
from app.runtime import prepare, start_background, stop_background

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    await prepare(maintenance=settings.run_workers)
    tasks = start_background(api=True, workers=settings.run_workers)
    yield
    await stop_background(tasks)


configure_composition()

app = FastAPI(title="WSP Suggestions API", lifespan=lifespan)


@app.exception_handler(DomainError)
async def domain_error_handler(_request: Request, exc: DomainError) -> JSONResponse:
    """Traducción única de los errores de dominio a HTTP (ver app.core.errors)."""
    return JSONResponse(exc.to_response(), status_code=exc.status_code)

# Expone /metrics (histogramas por ruta/método) para Prometheus. Solo lo
# alcanza nginx desde loopback (ver frontend/nginx.conf) — nunca queda
# público a través de dermicapro.cliniventas.com.
Instrumentator().instrument(app).expose(app)


@app.middleware("http")
async def add_performance_headers(request, call_next):
    # request_id: uuid4 por request, guardado en un contextvar para que
    # logging_config.RequestIdFilter lo agregue a cada línea de log emitida
    # durante esta request (incluidas las de tareas de fondo que la request
    # dispare mientras el contextvar sigue vigente, p.ej. automatizaciones
    # encoladas de forma síncrona). También se devuelve como header para que
    # el cliente (o un ticket de soporte) pueda referenciarlo.
    request_id = str(uuid.uuid4())
    request_id_token = set_request_id(request_id)
    tokens = begin_request_metrics()
    started_at = perf_counter()
    try:
        response = await call_next(request)
    except BaseException:
        finish_request_metrics(tokens)
        reset_request_id(request_id_token)
        raise
    total_ms = (perf_counter() - started_at) * 1000
    metrics = finish_request_metrics(tokens)
    timings = [f"app;dur={total_ms:.1f}", f"db;dur={metrics.database_ms:.1f}"]
    timings.extend(f"{name};dur={duration:.1f}" for name, duration in metrics.external_ms.items())
    response.headers["Server-Timing"] = ", ".join(timings)
    response.headers["X-DB-Queries"] = str(metrics.query_count)
    response.headers["X-Request-Id"] = request_id
    if total_ms >= 1000:
        logger.info(
            "Petición lenta %s %s total=%.1fms db=%.1fms queries=%s external=%s",
            request.method, request.url.path, total_ms, metrics.database_ms,
            metrics.query_count, metrics.external_ms,
        )
    reset_request_id(request_id_token)
    return response

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(
    TenantResolutionMiddleware,
    enabled=settings.multitenancy_enabled,
    platform_hosts=(
        host.strip() for host in settings.tenant_platform_hosts.split(",") if host.strip()
    ),
)

app.include_router(auth.router)
# Pública: la pantalla de acceso y el manifest de la PWA la leen sin sesión.
app.include_router(branding.router)
# El panel de plataforma trae su propia identidad y su propia cookie: el
# middleware de tenancy solo lo deja responder en TENANT_PLATFORM_HOSTS.
app.include_router(platform.router)
app.include_router(users.router)
app.include_router(lead_routes.router, dependencies=[Depends(get_current_user)])
app.include_router(chats.router, dependencies=[Depends(get_current_user)])
app.include_router(suggestions.router, dependencies=[Depends(get_current_user)])
app.include_router(tts.router, dependencies=[Depends(get_current_user)])
app.include_router(settings_router.router, dependencies=[Depends(require_admin)])
app.include_router(google_calendar.router, dependencies=[Depends(require_admin)])
# Vuelta de Google tras "Conectar con Google": una URL para todos los
# negocios, sin sesión; el negocio sale del state firmado.
app.include_router(google_calendar.callback_router)
app.include_router(ai_assistant.router, dependencies=[Depends(require_admin)])
app.include_router(whatsapp.router, dependencies=[Depends(require_admin)])
app.include_router(tags.router)
app.include_router(lead_services.router)
app.include_router(lead_stages.router)
app.include_router(template_categories.router)
app.include_router(tasks.router)
app.include_router(scheduled_messages.router)
app.include_router(templates.router)
app.include_router(media_library.router)
app.include_router(internal_notes.router)
app.include_router(issue_reports.router)
app.include_router(appointments.router)
app.include_router(custom_fields.router)
app.include_router(notifications.router)
app.include_router(push.router)
app.include_router(dashboard.router)
app.include_router(automations.router)
# El webhook de Meta se autentica con la firma HMAC de Meta, no con el token
# compartido: Meta no lo manda.
app.include_router(meta_webhook.router)
# webhooks y media.upload los llaman los workflows de IA de n8n (autenticados
# con su propio token, ver INBOUND_WEBHOOK_TOKEN) — no son sesiones de usuario.
app.include_router(
    webhooks.router,
    dependencies=[Depends(verify_webhook_token), Depends(bind_integration_tenant)],
)
app.include_router(
    media.router,
    dependencies=[Depends(verify_webhook_token), Depends(bind_integration_tenant)],
)
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
        logger.warning("Falló la verificación de salud del almacenamiento: %s", exc)
        raise HTTPException(status_code=503, detail="Media storage unavailable") from exc
    except (OSError, SQLAlchemyError) as exc:
        logger.warning("Falló la verificación de salud: %s", type(exc).__name__)
        raise HTTPException(status_code=503, detail="Database unavailable") from exc
    return {"status": "ok", "database": "ok", "media_storage": storage["backend"]}


@app.websocket("/ws/chats")
async def chats_websocket(websocket: WebSocket):
    if not websocket_origin_allowed(
        websocket.headers.get("origin"), websocket.headers.get("host"),
        settings.cors_origins, settings.cors_origin_regex,
    ):
        await websocket.close(code=4403)
        return
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
