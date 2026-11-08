"""Contratos HTTP de ai."""
from typing import Literal

from datetime import datetime
from pydantic import BaseModel, field_validator


class TtsRequest(BaseModel):
    text: str


class TtsResponse(BaseModel):
    content_type: str
    data_base64: str


class TtsStatus(BaseModel):
    configured: bool


# Tope de la indicación del asesor. Alineado con el maxLength del input del
# frontend (SuggestionInstructionBox): lo que se puede tipear es lo que viaja.
SUGGESTION_INSTRUCTION_MAX_LENGTH = 200


class SuggestionRequest(BaseModel):
    chat_id: str
    phone: str | None = None
    # Ignora la sugerencia cacheada y vuelve a pedirle una nueva a n8n — el
    # vendedor pide otras opciones porque las actuales no le sirven.
    force: bool = False
    # Indicación opcional del asesor para orientar la generación ("dar precio",
    # "no dar precio", "está interesado en Hollywood peel"). Se sanea acá para
    # que llegue limpia y acotada al prompt del workflow.
    instruction: str | None = None

    @field_validator("instruction")
    @classmethod
    def _clean_instruction(cls, value: str | None) -> str | None:
        if value is None:
            return None
        # Colapsa espacios y saltos de línea, descarta caracteres de control y
        # recorta al tope: el texto viaja como query param hasta el workflow.
        cleaned = " ".join(value.split())
        cleaned = "".join(ch for ch in cleaned if ch.isprintable())
        cleaned = cleaned[:SUGGESTION_INSTRUCTION_MAX_LENGTH].strip()
        return cleaned or None


class AnalysisRequest(BaseModel):
    chat_id: str


class Sugerencia(BaseModel):
    tactica: str
    canal: str
    texto: str | None = None
    adjuntos: list[str] = []
    motivo_adjuntos: str = ""
    porque: str


class SuggestionResponse(BaseModel):
    # `estado` es opcional: el workflow de n8n dejó de incluirlo en su salida
    # (ver senal_compra/alerta más abajo) y solo mandaba tipo_objecion en
    # versiones previas. Si algún día vuelve a mandarlo, se ignora: el
    # copiloto no mueve etapas (ver app/modules/ai/suggestions_api.py).
    estado: str | None = None
    tipo_objecion: str | None = None
    senal_compra: bool = False
    alerta: str | None = None
    confianza: str
    analisis: str
    sugerencias: list[Sugerencia]


class SuggestionUnavailable(BaseModel):
    """Por qué el negocio no tiene sugerencias (``ai_key_missing``, ``ai_disabled``,
    ``ai_not_configured``…), con el texto para el vendedor."""

    code: str
    message: str


class SuggestionStatus(BaseModel):
    """Estado de la sugerencia guardada de un lead: lectura barata que nunca
    dispara la generación. `stale` indica que el cliente escribió después de
    generarse — la UI la muestra igual pero avisa que quedó desactualizada.
    Con `unavailable` no hay sugerencia que mostrar: el panel explica qué falta."""

    suggestion: SuggestionResponse | None = None
    generated_at: datetime | None = None
    stale: bool = False
    unavailable: SuggestionUnavailable | None = None

from pydantic import BaseModel, Field
from app.modules.ai.knowledge_service import MAX_CONTENT_LENGTH, MAX_TITLE_LENGTH

class AIProfileBody(BaseModel):
    business_name: str | None = None
    business_description: str | None = None
    location: str | None = None
    opening_hours: str | None = None
    currency: str | None = None
    tone: str | None = None
    always_rules: str | None = None
    never_rules: str | None = None

class AIProfileItem(AIProfileBody):
    updated_at: str | None = None

KnowledgeDocumentType = Literal["ficha", "politica", "faq", "guion", "otro"]


class KnowledgeDocumentBody(BaseModel):
    title: str = Field(min_length=1, max_length=MAX_TITLE_LENGTH)
    content: str = Field(min_length=1, max_length=MAX_CONTENT_LENGTH)
    document_type: KnowledgeDocumentType | None = None
    # Servicio del catálogo; sin valor es conocimiento general.
    service_id: int | None = None

class KnowledgeDocumentSummary(BaseModel):
    id: str
    title: str
    document_type: str | None = None
    service_id: int | None = None
    template_id: int | None = None
    characters: int
    chunk_count: int
    created_at: str
    updated_at: str

class KnowledgeDocumentItem(KnowledgeDocumentSummary):
    content: str

class AIResourceBody(BaseModel):
    ai_description: str | None = Field(default=None, max_length=500)

class AIUsage(BaseModel):
    enabled: bool
    # None = sin tope mensual.
    monthly_quota: int | None = None
    used_this_month: int
    remaining: int | None = None


class LeadAnalysisResult(BaseModel):
    status: str
    job_id: str
    applied: bool
    # Los jobs aplicados antes de que el resultado guardara estos campos no
    # los traen.
    changed: bool | None = None
    stage: str | None = None


class AiProviderModels(BaseModel):
    provider: str
    label: str
    models: list[str]
    key_configured: bool


class AiProvidersStatus(BaseModel):
    """Lo que la tarjeta "Asistente IA" de Integraciones necesita."""

    providers: list[AiProviderModels]
    primary_model: str
    fallback_model: str
    # Hay clave para el modelo principal o el secundario.
    ready: bool


class AiProviderTestRequest(BaseModel):
    provider: str
    # En blanco, se prueba la clave guardada.
    api_key: str | None = Field(default=None, max_length=500)
    model: str | None = Field(default=None, max_length=80)


class AiProviderTestResult(BaseModel):
    ok: bool
    provider: str
    # Vacío en la prueba de clave (no se genera con ningún modelo).
    model: str | None = None
    error: str | None = None
    latency_ms: int | None = None
    # Prueba de clave: cuántos modelos ve la clave en el proveedor.
    models_available: int | None = None


class KnowledgePdfImportRequest(BaseModel):
    filename: str = Field(default="", max_length=255)
    # El PDF en base64 (sin el prefijo ``data:``); hasta 10 MB.
    data_base64: str = Field(min_length=1, max_length=14_500_000)


class KnowledgePdfImport(BaseModel):
    """Texto extraído para revisar antes de guardarlo como documento."""

    title: str
    content: str
    pages: int
    characters: int
    truncated: bool


class KnowledgeTemplateSummary(BaseModel):
    """Plantilla de la plataforma que el negocio puede importar."""

    id: int
    title: str
    document_type: str | None = None
    service_hint: str | None = None
    content: str
    version: int
    characters: int
    imported: bool


class KnowledgeTemplateImport(BaseModel):
    # Servicio del negocio al que queda vinculada la copia; sin valor, general.
    service_id: int | None = None
