"""El copiloto de sugerencias corriendo dentro del CRM, con las claves del
negocio. Hace lo mismo que el workflow de n8n, en el mismo orden y con los
mismos pasos auditados, sin salir del proceso:

1. carga el contexto autorizado del lead (``context_loaded``);
2. carga el catálogo con paquetes, las compras y los recursos;
3. busca conocimiento con una consulta armada a partir del servicio de
   interés y los últimos mensajes del cliente (``knowledge_searched``);
4. arma el prompt y pide una respuesta JSON al modelo principal; si falla o
   no valida tras un reintento, al secundario;
5. anota en el job qué modelo respondió, cuántos tokens costó y qué
   fragmentos entraron.

El analista sigue en n8n: ``analyze`` no está implementado aquí a propósito.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.integrations.llm.base import LlmClient, LlmError, LlmRequest
from app.integrations.llm.catalog import DEFAULT_FALLBACK, DEFAULT_PRIMARY, key_setting_for, parse_model_spec
from app.integrations.llm.client import build_client
from app.modules.ai.ai_assistant_service import fetch_tenant_config, list_ai_catalog, list_ai_resources
from app.modules.ai.ai_context import fetch_analysis_context
from app.modules.ai.ai_jobs import record_ai_job_metadata, record_ai_job_step, start_ai_job
from app.modules.ai.knowledge_search import search_knowledge_chunks, service_knowledge_chunks
from app.modules.ai.schemas import SuggestionResponse
from app.modules.platform.ports.settings_service import get_effective_many

logger = logging.getLogger(__name__)

PROMPT_VERSION = "copiloto-2026-11-07"
_PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "copiloto.md"
# Mensajes recientes que entran al prompt (los más viejos quedan fuera: el
# contexto de una venta vive en las últimas semanas, no en todo el historial).
MAX_MESSAGES = 80
# Fragmentos de conocimiento por consulta y en total.
KNOWLEDGE_TOP_K = 6
# Fragmentos reservados a los documentos del servicio de interés del lead.
SERVICE_TOP_K = 4
KNOWLEDGE_MAX_CHARS = 9000
# Últimos mensajes del cliente que alimentan la consulta de conocimiento.
QUERY_CUSTOMER_MESSAGES = 3

SETTING_KEYS = ("ai_primary_model", "ai_fallback_model", "ai_gemini_api_key", "ai_openai_api_key")


class NativeSuggestionError(Exception):
    """No se pudo generar con ningún modelo configurado."""


# Mismo JSON que exige el parser del workflow de n8n: el frontend ya lo lee.
SUGGESTION_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "analisis": {"type": "string"},
        "confianza": {"type": "string", "enum": ["alta", "media", "baja"]},
        "senal_compra": {"type": "boolean"},
        "alerta": {"type": ["string", "null"]},
        "sugerencias": {
            "type": "array",
            "maxItems": 3,
            "items": {
                "type": "object",
                "properties": {
                    "tactica": {"type": "string"},
                    "canal": {"type": "string", "enum": ["texto", "audio"]},
                    "texto": {"type": "string"},
                    "adjuntos": {"type": "array", "items": {"type": "string"}, "maxItems": 3},
                    "motivo_adjuntos": {"type": "string"},
                    "porque": {"type": "string"},
                },
                "required": ["tactica", "canal", "texto", "adjuntos", "motivo_adjuntos", "porque"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["analisis", "confianza", "senal_compra", "alerta", "sugerencias"],
    "additionalProperties": False,
}


def load_system_prompt() -> str:
    return _PROMPT_PATH.read_text(encoding="utf-8")


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, default=str)


# Palabras que no aportan a la búsqueda aunque superen el largo mínimo.
_STOPWORDS = frozenset({
    "hola", "buenas", "buenos", "tardes", "noches", "gracias", "quiero", "quisiera", "tengo", "tienen",
    "tiene", "puedo", "pueden", "sobre", "para", "como", "cuanto", "cuanta", "cuantos", "cuantas",
    "cuando", "donde", "este", "esta", "esto", "estos", "estas", "ese", "esa", "eso", "porque",
    "pero", "tambien", "muy", "mas", "favor", "necesito", "saber", "info", "informacion",
})
MIN_WORD_LENGTH = 4
MAX_QUERY_WORDS = 16


def _fold(word: str) -> str:
    import unicodedata
    return "".join(ch for ch in unicodedata.normalize("NFD", word) if unicodedata.category(ch) != "Mn")


def or_query(text: str) -> str:
    """Una consulta que encuentra fragmentos con *cualquiera* de las palabras
    significativas (``websearch_to_tsquery`` une con AND si no se le dice
    ``or``): con AND, "¿Cuántas sesiones necesito?" no encontraba una ficha
    que solo dice "sesiones". El ranking sigue premiando a los fragmentos que
    coinciden en más palabras."""
    import re
    words: list[str] = []
    for raw in re.findall(r"[\wáéíóúüñÁÉÍÓÚÜÑ]+", text.lower()):
        if len(raw) < MIN_WORD_LENGTH or raw.isdigit() or _fold(raw) in _STOPWORDS:
            continue
        if raw not in words:
            words.append(raw)
    return " or ".join(words[:MAX_QUERY_WORDS])


def conversation_query(messages: list[dict]) -> str:
    """Lo último que dijo el cliente, como búsqueda por cualquier palabra.
    ``messages`` llega del más nuevo al más viejo: se da vuelta para que la
    consulta lea en el orden de la conversación."""
    customer = [
        str(m.get("content") or "").strip()
        for m in reversed(messages)
        if m.get("sender") == "cliente" and str(m.get("content") or "").strip()
    ][-QUERY_CUSTOMER_MESSAGES:]
    return or_query(" ".join(customer))


def knowledge_queries(lead: dict, messages: list[dict], instruction: str | None) -> list[str]:
    """Qué buscar antes de llamar al modelo: primero el servicio de interés
    solo (su ficha es lo más útil), después lo último que dijo el cliente y la
    indicación del vendedor, cada una como búsqueda por cualquier palabra."""
    service = str(lead.get("servicio_interes") or "").strip()
    queries = [service, conversation_query(messages)]
    if instruction and instruction.strip():
        queries.append(or_query(instruction))
    unique: list[str] = []
    for query in queries:
        if query and query not in unique:
            unique.append(query)
    return unique


def compact_messages(messages: list[dict]) -> list[dict]:
    """Del más antiguo al más nuevo, solo lo que el modelo necesita leer."""
    recent = list(reversed(messages))[-MAX_MESSAGES:]
    compact = []
    for message in recent:
        item = {"de": message.get("sender"), "fecha": message.get("sent_at"), "texto": message.get("content")}
        if message.get("message_type") not in (None, "text"):
            item["tipo"] = message.get("message_type")
        compact.append(item)
    return compact


def compact_catalog(catalog: list[dict]) -> list[dict]:
    return [
        {
            "servicio": item["name"],
            **({"descripcion": item["description"]} if item.get("description") else {}),
            **({"notas": item["price_notes"]} if item.get("price_notes") else {}),
            "paquetes": [
                {"nombre": p["name"], "sesiones": p["sessions"], "precio": p["price"], **({"notas": p["notes"]} if p.get("notes") else {})}
                for p in item.get("packages", [])
            ],
        }
        for item in catalog
    ]


def _hours_since(value: Any, now: datetime) -> float | None:
    if not value:
        return None
    try:
        when = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return round((now - when).total_seconds() / 3600, 1)


def build_user_prompt(
    *,
    tenant_config: dict,
    lead: dict,
    messages: list[dict],
    resources: list[dict],
    catalog: list[dict],
    knowledge: list[dict],
    instruction: str | None,
    now: datetime,
) -> str:
    lead_view = {
        key: lead.get(key)
        for key in ("nombre", "estado", "tipo_objecion", "servicio_interes", "notas", "con_especialista", "contador_noshow", "proxima_cita")
    }
    knowledge_view = [
        {
            "titulo": item["title"],
            **({"tipo": item["document_type"]} if item.get("document_type") else {}),
            "texto": item["content"],
        }
        for item in knowledge
    ]
    sections = [
        "<negocio>\nPerfil que cargó el negocio (nombre, descripción, ubicación, horarios, moneda, tono y reglas). Vacío si todavía no lo configuró:\n"
        + _json(tenant_config) + "\n</negocio>",
        "<lead>\nEstado e información del lead (nombre, estado YA clasificado, tipo_objecion, servicio_interes, notas, con_especialista, contador_noshow, proxima_cita):\n"
        + _json(lead_view) + "\n</lead>",
        "<datos_temporales>\n- Fecha y hora actual: " + now.isoformat()
        + "\n- Último mensaje enviado por: " + str(lead.get("ultimo_emisor") or "desconocido") + "   (cliente | vendedor)"
        + "\n- Horas desde el último mensaje: " + str(_hours_since(lead.get("ultimo_mensaje_at"), now))
        + "\n</datos_temporales>",
        "<catalogo>\nServicios y paquetes vigentes (precios en la moneda del negocio):\n" + _json(compact_catalog(catalog)) + "\n</catalogo>",
        "<compras>\nLo que este lead ya compró (servicio, paquete, sesiones, monto, fecha):\n" + _json(lead.get("compras") or []) + "\n</compras>",
        "<recursos_disponibles>\nArchivos que el negocio autorizó como adjuntos (id, nombre, tipo, url, descripcion):\n" + _json(resources) + "\n</recursos_disponibles>",
        "<conocimiento>\nFragmentos de fichas, políticas y guías del negocio elegidos para esta conversación:\n" + _json(knowledge_view) + "\n</conocimiento>",
        "<historial>\nConversación de WhatsApp (más antiguo arriba):\n" + _json(compact_messages(messages)) + "\n</historial>",
        "<indicacion_vendedor>\nIndicación puntual del vendedor para ESTA generación (vacío si no dio ninguna):\n" + (instruction or "") + "\n</indicacion_vendedor>",
        "Analiza y devuelve el JSON según el esquema de salida.",
    ]
    return "\n\n".join(sections)


def service_id_for(lead: dict, catalog: list[dict]) -> int | None:
    """El servicio de interés del lead es texto (lo comparten n8n y las
    automatizaciones): se ubica en el catálogo por nombre."""
    wanted = str(lead.get("servicio_interes") or "").strip().casefold()
    if not wanted:
        return None
    for item in catalog:
        if str(item.get("name") or "").strip().casefold() == wanted:
            return item.get("id")
    return None


async def gather_knowledge(lead: dict, messages: list[dict], instruction: str | None, catalog: list[dict]) -> list[dict]:
    """Primero lo del servicio que le interesa al lead (su ficha es lo más
    útil y a veces la conversación todavía no dice nada buscable), después la
    búsqueda general. Sin repetidos y dentro del presupuesto de caracteres."""
    seen: set[str] = set()
    knowledge: list[dict] = []

    def add(chunks: list[dict]) -> None:
        for chunk in chunks:
            if chunk["id"] not in seen:
                seen.add(chunk["id"])
                knowledge.append(chunk)

    service_id = service_id_for(lead, catalog)
    if service_id is not None:
        conversation = conversation_query(messages)
        found = await search_knowledge_chunks(conversation, SERVICE_TOP_K, service_id) if conversation else []
        add(found or await service_knowledge_chunks(service_id, SERVICE_TOP_K))
    for query in knowledge_queries(lead, messages, instruction):
        add(await search_knowledge_chunks(query, KNOWLEDGE_TOP_K))
    return _trim_knowledge(knowledge)


def _trim_knowledge(chunks: list[dict]) -> list[dict]:
    kept, used = [], 0
    for chunk in chunks:
        size = len(chunk.get("content") or "")
        if used + size > KNOWLEDGE_MAX_CHARS and kept:
            break
        kept.append(chunk)
        used += size
    return kept


async def _models_for_tenant() -> list[tuple[str, str]]:
    """``[(spec, api_key)]`` en orden: principal y, si tiene clave, secundario."""
    values = await get_effective_many(SETTING_KEYS)
    primary = values["ai_primary_model"].strip() or DEFAULT_PRIMARY
    fallback = values["ai_fallback_model"].strip() or DEFAULT_FALLBACK
    chain = []
    for spec in (primary, fallback):
        if spec in [s for s, _ in chain]:
            continue
        provider, _ = parse_model_spec(spec)
        key = values[key_setting_for(provider)].strip()
        if key:
            chain.append((spec, key))
    return chain


class NativeAiProvider:
    def __init__(self, client_factory=build_client) -> None:
        self._build = client_factory

    async def analyze(self, chat_id, *, job_id, context_revision, tenant_context_token):
        raise NotImplementedError("El analista sigue en n8n")

    async def suggest(self, chat_id, phone, *, refresh, instruction, job_id, context_revision, tenant_context_token):
        chain = await _models_for_tenant()
        if not chain:
            raise NativeSuggestionError("El negocio no tiene una clave de IA configurada")

        await start_ai_job(job_id, operation="rag", resource_id=chat_id)
        context = await fetch_analysis_context(chat_id)
        if context is None:
            raise NativeSuggestionError("Lead no encontrado")
        if context["context_revision"] != context_revision:
            raise NativeSuggestionError("El contexto del lead cambió mientras se generaba")
        await record_ai_job_step(job_id, "context_loaded")

        lead, messages = context["lead"], context["messages"]
        tenant_config = await fetch_tenant_config()
        catalog = await list_ai_catalog()
        resources = await list_ai_resources()

        knowledge = await gather_knowledge(lead, messages, instruction, catalog)
        await record_ai_job_step(job_id, "knowledge_searched")

        now = datetime.now(timezone.utc)
        request = LlmRequest(
            system=load_system_prompt(),
            user=build_user_prompt(
                tenant_config=tenant_config, lead=lead, messages=messages, resources=resources,
                catalog=catalog, knowledge=knowledge, instruction=instruction, now=now,
            ),
            schema=SUGGESTION_SCHEMA,
            schema_name="sugerencias_copiloto",
        )

        errors: list[str] = []
        for spec, api_key in chain:
            client = self._build(spec, api_key)
            try:
                suggestion, result = await _generate_validated(client, request)
            except LlmError as exc:
                errors.append(f"{spec}: {exc}")
                logger.warning("Modelo %s falló para el chat %s: %s", spec, chat_id, exc)
                if not exc.retryable and len(chain) == 1:
                    break
                continue
            await record_ai_job_metadata(
                job_id,
                provider="native", model=f"{client.provider}:{result.model}", prompt_version=PROMPT_VERSION,
                tokens_in=result.tokens_in, tokens_out=result.tokens_out,
                knowledge_chunk_ids=[chunk["id"] for chunk in knowledge],
                failed_models=errors or None,
            )
            return suggestion
        raise NativeSuggestionError("; ".join(errors) or "Ningún modelo respondió")


async def _generate_validated(client: LlmClient, request: LlmRequest) -> tuple[SuggestionResponse, Any]:
    """Una llamada y, si el JSON no valida, un único reintento que le muestra
    al modelo el error. Lo que no valide después de eso pasa al secundario."""
    result = await client.complete_json(request)
    try:
        return _parse(result.text), result
    except (ValueError, ValidationError) as exc:
        retry = LlmRequest(
            system=request.system,
            user=request.user + "\n\nTu respuesta anterior no cumplió el esquema (" + str(exc)[:500] + "). Devuelve únicamente el JSON válido.",
            schema=request.schema, schema_name=request.schema_name, max_output_tokens=request.max_output_tokens,
        )
        result = await client.complete_json(retry)
        try:
            return _parse(result.text), result
        except (ValueError, ValidationError) as again:
            raise LlmError(f"Respuesta inválida de {client.provider}: {again}") from again


def _parse(text: str) -> SuggestionResponse:
    payload = json.loads(text)
    if not isinstance(payload, dict):
        raise ValueError("la respuesta no es un objeto")
    return SuggestionResponse.model_validate(payload)
