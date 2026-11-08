"""El copiloto nativo contra PostgreSQL real: contexto, catálogo con paquetes,
compras, conocimiento y job auditado, con el modelo simulado."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import insert, select

from app.db.models.ai import AIJob
from app.db.models.auth import User
from app.db.models.conversations import WspMessage
from app.db.models.leads import Lead
from app.db.uow import session_scope
from app.integrations.llm.base import LlmResult
from app.modules.ai.ai_context import fetch_analysis_context
from app.modules.ai.ai_jobs import create_ai_job
from app.modules.ai.infrastructure.native_provider import NativeAiProvider
from app.modules.ai.knowledge_service import create_document
from app.modules.catalogs.service import create_lead_service, create_service_package
from app.modules.leads.application.sales import SaleInput, record_sale
from app.modules.leads.domain.lead import Actor
from app.modules.leads.infrastructure.repository import ensure_lead_stub
from app.modules.platform.ports.settings_service import update_settings
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401

ANSWER = json.dumps({
    "analisis": "Pregunta por el pack", "confianza": "alta", "senal_compra": True, "alerta": None,
    "sugerencias": [{"tactica": "Cotizar", "canal": "texto", "texto": "El pack x3 cuesta 400.", "adjuntos": [], "motivo_adjuntos": "", "porque": "Pidió precio"}],
})


class RecordingClient:
    provider = "gemini"
    model = "gemini-3.6-flash"

    def __init__(self):
        self.requests = []

    async def complete_json(self, request):
        self.requests.append(request)
        return LlmResult(text=ANSWER, model=self.model, tokens_in=1500, tokens_out=200)

    async def ping(self):
        return LlmResult(text="OK", model=self.model)


async def test_native_suggestion_end_to_end(tenant) -> None:
    lead_id = str(uuid4())
    now = datetime.now(timezone.utc)
    with tenant_context(tenant):
        async with session_scope() as session:
            user = User(email=f"a-{uuid4().hex[:6]}@example.test", name="Lucía", password_hash="!", role="admin", is_active=True, created_at=now)
            session.add(user)
            await session.flush()
            admin_id = user.id
        peel = await create_lead_service("Hollywood Peel - Rostro", admin_id)
        await create_service_package(peel["id"], {"name": "x3", "sessions": 3, "price": Decimal("400"), "notes": None, "position": None})
        cejas = await create_lead_service("Borrado de Cejas", admin_id)
        cejas_single = await create_service_package(cejas["id"], {"name": "Individual", "sessions": 1, "price": Decimal("300"), "notes": None, "position": None})
        await create_document("Ficha Hollywood Peel", "El Hollywood Peel usa carbón activado y láser. Se recomiendan 3 sesiones para manchas.")
        await create_document("Política de pagos", "Aceptamos Yape y tarjeta. No hay devoluciones.")

        await ensure_lead_stub(lead_id, None, None)
        async with session_scope() as session:
            await session.execute(Lead.__table__.update().where(Lead.id == lead_id).values(nombre="Ana", servicio_interes="Hollywood Peel - Rostro"))
            await session.execute(insert(WspMessage).values(chat_id=lead_id, sender="cliente", content="Hola, tengo manchas", sent_at=now - timedelta(minutes=5), message_type="text"))
            await session.execute(insert(WspMessage).values(chat_id=lead_id, sender="cliente", content="¿Cuántas sesiones necesito?", sent_at=now - timedelta(minutes=1), message_type="text"))
        await record_sale(lead_id, SaleInput(service_id=cejas["id"], package_id=cejas_single["id"]), actor=Actor.user(admin_id))

        await update_settings({"ai_gemini_api_key": "AIza-test"})
        context = await fetch_analysis_context(lead_id)
        job, _ = await create_ai_job("rag", lead_id, chat_id=lead_id, context_revision=context["context_revision"])

        client = RecordingClient()
        built = []

        def factory(spec, api_key, overrides=None):
            built.append((spec, api_key))
            return client

        suggestion = await NativeAiProvider(client_factory=factory).suggest(
            lead_id, None, refresh=False, instruction=None, job_id=job.id,
            context_revision=context["context_revision"], tenant_context_token="tok",
        )

        assert suggestion.sugerencias[0].texto == "El pack x3 cuesta 400."
        assert built == [("gemini:gemini-3.6-flash", "AIza-test")]
        prompt = client.requests[0].user
        assert '"x3"' in prompt and '"400.00"' in prompt
        assert "carbón activado" in prompt  # la ficha del servicio de interés
        assert '"Borrado de Cejas"' in prompt and '"Individual"' in prompt  # compras previas
        assert prompt.index("Hola, tengo manchas") < prompt.index("¿Cuántas sesiones necesito?")

        async with session_scope() as session:
            stored = await session.scalar(select(AIJob).where(AIJob.id == job.id))
        metadata = stored.request_metadata
        assert metadata["completed_steps"] == ["context_loaded", "knowledge_searched"]
        assert metadata["model"] == "gemini:gemini-3.6-flash"
        assert (metadata["tokens_in"], metadata["tokens_out"]) == (1500, 200)
        assert metadata["knowledge_chunk_ids"]
        assert stored.status == "running"
