"""El copiloto de sugerencias corriendo dentro del CRM, con las claves del
negocio. Hace lo mismo que el workflow de n8n, en el mismo orden y con los
mismos pasos auditados, sin salir del proceso:

1. carga el contexto autorizado del lead (``context_loaded``);
2. carga el catálogo con paquetes y los recursos;
3. busca conocimiento a partir del servicio de interés y los últimos mensajes
   del cliente, por palabras y por significado, y combina las dos búsquedas
   (``knowledge_searched``);
4. arma el prompt y pide una respuesta JSON al modelo principal; si falla o
   no valida tras un reintento, al secundario;
5. anota en el job qué modelo respondió, cuántos tokens costó y qué
   fragmentos entraron.

El analista sigue en n8n: ``analyze`` no está implementado aquí a propósito.
"""

from __future__ import annotations

import json
import logging
import re
import unicodedata
from datetime import datetime, timezone, tzinfo
from pathlib import Path
from typing import Any

from pydantic import ValidationError

from app.integrations.llm.base import LlmClient, LlmError, LlmRequest
from app.integrations.llm.catalog import default_models, effective_params, key_setting_for, parse_model_spec, parse_overrides, resolve_model_spec
from app.integrations.llm.client import build_client
from app.integrations.llm.embeddings import EmbeddingClient, build_embedding_client
from app.modules.ai.ai_assistant_service import fetch_tenant_config, list_ai_catalog, list_ai_resources
from app.modules.ai.ai_context import fetch_analysis_context
from app.modules.ai.ai_jobs import record_ai_job_metadata, record_ai_job_step, start_ai_job
from app.modules.ai.knowledge_search import chunks_by_ids, fuse_rankings, referenced_chunks, search_knowledge_chunks, service_knowledge_chunks
from app.modules.ai.knowledge_vectors import ensure_embeddings, vector_search
from app.modules.ai.schemas import SuggestionResponse
from app.modules.ai.suggestions_repository import get_cached_suggestion
from app.modules.leads.ports.stages import list_stages_for_ai
from app.modules.platform.ports.settings_service import get_effective_many
from app.modules.platform.public import business_timezone

logger = logging.getLogger(__name__)

PROMPT_VERSION = "copiloto-2026-11-09"
# Dos mitades, con los mismos nombres que el nodo de n8n del que viene:
# - system prompt (prompts/system_prompt.md): texto fijo de la plataforma,
#   igual para todos los negocios; dice cómo comportarse y cómo leer cada
#   bloque del user prompt.
# - user prompt (build_user_prompt): los datos de este pedido, armados en cada
#   sugerencia: <negocio> (el Perfil del negocio), <lead>, <catalogo>,
#   <recursos_disponibles>, <conocimiento> (solo los fragmentos
#   que la búsqueda eligió), <historial> e <indicacion_vendedor>.
_SYSTEM_PROMPT_PATH = Path(__file__).resolve().parent.parent / "prompts" / "system_prompt.md"
# Mensajes recientes que entran al prompt (los más viejos quedan fuera: el
# contexto de una venta vive en las últimas semanas, no en todo el historial).
MAX_MESSAGES = 80
# Fragmentos de conocimiento por consulta y en total.
KNOWLEDGE_TOP_K = 6
# Fragmentos reservados a los documentos del servicio de interés del lead.
SERVICE_TOP_K = 4
# Fragmentos de la búsqueda general una vez combinadas palabras y significado.
GLOBAL_TOP_K = 8
# Fichas que se suman porque un fragmento encontrado las nombra.
REFERENCE_TOP_K = 3
KNOWLEDGE_MAX_CHARS = 9000
# Últimos mensajes del cliente que alimentan la consulta de conocimiento.
QUERY_CUSTOMER_MESSAGES = 3

SETTING_KEYS = (
    "ai_suggestions_primary_model", "ai_suggestions_fallback_model",
    "ai_suggestions_primary_params", "ai_suggestions_fallback_params",
    "ai_gemini_api_key", "ai_openai_api_key",
)


class NativeSuggestionError(Exception):
    """No se pudo generar con ningún modelo configurado."""


# Mismo JSON que exige el parser del workflow de n8n: el frontend ya lo lee.
# Cada campo lleva su descripción porque el prompt no los definía y el modelo
# llenaba `alerta` o `confianza` a su criterio (panel del 2026-11-09). Los dos
# proveedores reciben el esquema con las descripciones.
SUGGESTION_SCHEMA: dict = {
    "type": "object",
    "properties": {
        "analisis": {
            "type": "string",
            "description": "Qué quiere el cliente, en qué punto está la venta y qué lo frena, en dos o tres frases para el vendedor.",
        },
        "confianza": {
            "type": "string", "enum": ["alta", "media", "baja"],
            "description": "alta si el historial y el conocimiento sostienen las jugadas; media si falta algún dato; baja si la conversación es ambigua o hay poca información.",
        },
        "senal_compra": {
            "type": "boolean",
            "description": "true si el cliente mostró intención de comprar o agendar: pregunta el precio para decidir, pide horario, dice que quiere empezar.",
        },
        "alerta": {
            "type": ["string", "null"],
            "description": "Solo lo que el vendedor debe saber antes de responder: riesgo de perder al lead, pedido de no contacto, posible menor de edad, dato de salud que requiere al especialista, queja o reclamo. null si no hay nada.",
        },
        "sugerencias": {
            "type": "array",
            "maxItems": 3,
            "items": {
                "type": "object",
                "properties": {
                    "tactica": {"type": "string", "description": "Nombre corto de la jugada, de dos a cinco palabras (Cotizar el pack, Reagendar sin reproche)."},
                    "canal": {
                        "type": "string", "enum": ["texto", "audio"],
                        "description": "texto para enviarlo escrito; audio cuando conviene la voz (explicación larga, cercanía, cliente que manda audios).",
                    },
                    "texto": {"type": "string", "description": "El mensaje listo para enviar por WhatsApp, en el tono del negocio."},
                    "adjuntos": {
                        "type": "array", "items": {"type": "string"}, "maxItems": 3,
                        "description": "URLs exactas de <recursos_disponibles> que acompañan el mensaje; vacío si ninguno encaja.",
                    },
                    "motivo_adjuntos": {"type": "string", "description": "Por qué esos adjuntos ayudan en esta jugada; en blanco si no hay adjuntos."},
                    "porque": {"type": "string", "description": "Por qué esta jugada conviene ahora, para el vendedor, en una o dos frases."},
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
    """El system prompt: fijo, de la plataforma, sin datos de ningún negocio."""
    return _SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")


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
    return "".join(ch for ch in unicodedata.normalize("NFD", word) if unicodedata.category(ch) != "Mn")


def or_query(text: str) -> str:
    """Una consulta que encuentra fragmentos con *cualquiera* de las palabras
    significativas (``websearch_to_tsquery`` une con AND si no se le dice
    ``or``): con AND, "¿Cuántas sesiones necesito?" no encontraba una ficha
    que solo dice "sesiones". El ranking sigue premiando a los fragmentos que
    coinciden en más palabras."""
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


def service_family(name: str) -> str:
    """El tratamiento sin la zona: "Botox - 2 Zonas" → "Botox". Es como el
    ERP nombra las variantes y como el frontend las agrupa
    (``serviceFamilies.ts``)."""
    return name.split(" - ", 1)[0].strip()


def service_query(name: str) -> str:
    """El servicio de interés como consulta de texto. El nombre tal cual no
    servía: ``websearch_to_tsquery`` lee el « - Zona» de 56 de los 62
    servicios del ERP como un NOT ("HIFU 12D - Rostro" → ``hifu & 12d &
    !rostro``) y la ficha, que habla del rostro, no aparecía nunca. Quedan
    solo las palabras del tratamiento, unidas con AND."""
    return " ".join(re.findall(r"[\wáéíóúüñÁÉÍÓÚÜÑ]+", service_family(name)))


def knowledge_queries(lead: dict, messages: list[dict], instruction: str | None) -> list[str]:
    """Qué buscar antes de llamar al modelo: primero el servicio de interés
    solo (su ficha es lo más útil), después lo último que dijo el cliente y la
    indicación del vendedor, cada una como búsqueda por cualquier palabra."""
    service = service_query(str(lead.get("servicio_interes") or ""))
    queries = [service, conversation_query(messages)]
    if instruction and instruction.strip():
        queries.append(or_query(instruction))
    unique: list[str] = []
    for query in queries:
        if query and query not in unique:
            unique.append(query)
    return unique


def _local_time(value: Any, tz: tzinfo | None) -> Any:
    """La hora como la vive el negocio. Los mensajes se guardan en UTC y así
    llegaban al prompt: un "buenas noches" de las 21:00 en Lima decía 02:00
    del día siguiente, y el modelo contaba mal las horas y los días."""
    if tz is None or not value:
        return value
    try:
        when = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return value
    if when.tzinfo is None:
        when = when.replace(tzinfo=timezone.utc)
    return when.astimezone(tz).isoformat(timespec="minutes")


def compact_messages(messages: list[dict], tz: tzinfo | None = None) -> list[dict]:
    """Del más antiguo al más nuevo, solo lo que el modelo necesita leer, con
    las horas en la zona del negocio."""
    recent = list(reversed(messages))[-MAX_MESSAGES:]
    compact = []
    for message in recent:
        item = {"de": message.get("sender"), "fecha": _local_time(message.get("sent_at"), tz), "texto": message.get("content")}
        if message.get("message_type") not in (None, "text"):
            item["tipo"] = message.get("message_type")
        if message.get("anuncio"):
            item["origen"] = message["anuncio"]
        compact.append(item)
    return compact


def compact_catalog(catalog: list[dict]) -> list[dict]:
    return [
        {
            "servicio": item["name"],
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
    # El Perfil del negocio (pestaña "Perfil" de Asistente IA) viaja acá, en
    # <negocio>, como dato: el system prompt solo dice cómo usarlo.
    tenant_config: dict,
    lead: dict,
    messages: list[dict],
    resources: list[dict],
    catalog: list[dict],
    knowledge: list[dict],
    instruction: str | None,
    now: datetime,
    stages: list[dict] | None = None,
    previous: dict | None = None,
) -> str:
    lead_view = {
        key: lead.get(key)
        for key in ("nombre", "estado", "tipo_objecion", "servicio_interes", "notas", "con_especialista", "contador_noshow", "proxima_cita")
    }
    # ``estado`` es la clave de una etapa del negocio ("seguimiento_2"): sin
    # su nombre y descripción el modelo adivinaba qué significaba.
    stage = next((item for item in stages or [] if item.get("key") == lead.get("estado")), None)
    if stage is not None:
        lead_view["etapa"] = {"nombre": stage.get("name"), "tipo": stage.get("kind"), "descripcion": stage.get("description")}
    lead_view["proxima_cita"] = _local_time(lead_view.get("proxima_cita"), now.tzinfo)
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
        "<lead>\nEstado e información del lead (nombre, estado YA clasificado y su etapa con nombre y descripción, tipo_objecion, servicio_interes, notas, con_especialista, contador_noshow, proxima_cita):\n"
        + _json(lead_view) + "\n</lead>",
        "<datos_temporales>\n- Fecha y hora actual (zona del negocio): " + now.isoformat(timespec="minutes")
        + "\n- Último mensaje enviado por: " + str(lead.get("ultimo_emisor") or "desconocido") + "   (cliente | vendedor)"
        + "\n- Horas desde el último mensaje: " + str(_hours_since(lead.get("ultimo_mensaje_at"), now))
        + "\n</datos_temporales>",
        "<catalogo>\nServicios y paquetes vigentes (precios en la moneda del negocio):\n" + _json(compact_catalog(catalog)) + "\n</catalogo>",
        "<recursos_disponibles>\nArchivos que el negocio autorizó como adjuntos (id, nombre, tipo, url, descripcion):\n" + _json(resources) + "\n</recursos_disponibles>",
        "<conocimiento>\nFragmentos de fichas, políticas y guías del negocio elegidos para esta conversación:\n" + _json(knowledge_view) + "\n</conocimiento>",
        "<historial>\nConversación de WhatsApp (más antiguo arriba, horas en la zona del negocio):\n" + _json(compact_messages(messages, now.tzinfo)) + "\n</historial>",
        # «Genera otras» mandaba el mismo prompt y volvían las mismas tres
        # jugadas: ahora el modelo ve cuáles descartó el vendedor.
        *(["<descartadas>\nJugadas que el vendedor ya vio y descartó al pedir otras (táctica y texto): propone distintas:\n" + _json(_discarded(previous)) + "\n</descartadas>"] if previous else []),
        "<indicacion_vendedor>\nIndicación puntual del vendedor para ESTA generación (vacío si no dio ninguna):\n" + (instruction or "") + "\n</indicacion_vendedor>",
        "Analiza y devuelve el JSON según el esquema de salida.",
    ]
    return "\n\n".join(sections)


def _discarded(previous: dict) -> list[dict]:
    return [
        {"tactica": item.get("tactica"), "texto": item.get("texto")}
        for item in previous.get("sugerencias") or [] if isinstance(item, dict)
    ]


def _same(name: str) -> str:
    return " ".join(_fold(name).casefold().split())


def service_id_for(lead: dict, catalog: list[dict]) -> int | None:
    """El servicio de interés del lead es texto (lo comparten n8n y las
    automatizaciones): se ubica en el catálogo por nombre. El analista nunca
    ve el catálogo y escribe "Botox" o "depilación láser": si no hay un nombre
    igual, vale la primera variante del mismo tratamiento (las fichas se
    vinculan a todas sus zonas)."""
    wanted = _same(str(lead.get("servicio_interes") or ""))
    if not wanted:
        return None
    for item in catalog:
        if _same(str(item.get("name") or "")) == wanted:
            return item.get("id")
    family = _same(service_family(wanted))
    for item in catalog:
        if _same(service_family(str(item.get("name") or ""))) == family:
            return item.get("id")
    return None


def semantic_query(lead: dict, messages: list[dict], instruction: str | None) -> str:
    """Lo mismo que alimenta la búsqueda por palabras, pero como texto
    corrido: el embedding entiende la frase entera, no hace falta partirla."""
    customer = [
        str(m.get("content") or "").strip()
        for m in reversed(messages)
        if m.get("sender") == "cliente" and str(m.get("content") or "").strip()
    ][-QUERY_CUSTOMER_MESSAGES:]
    parts = [str(lead.get("servicio_interes") or "").strip(), *customer, (instruction or "").strip()]
    return "\n".join(part for part in parts if part)


async def _query_vector(embedder: EmbeddingClient | None, text: str) -> tuple[list[float] | None, dict]:
    """El vector de la consulta y cómo se buscó. Si la API de embeddings falla
    la sugerencia sigue, solo por palabras: el conocimiento ayuda, pero no
    vale una sugerencia perdida."""
    if embedder is None or not text:
        return None, {"retrieval": "palabras"}
    try:
        embedded = await ensure_embeddings(embedder)
        [vector] = await embedder.embed([text])
    except LlmError as exc:
        logger.warning("Búsqueda por significado no disponible (%s): %s", embedder.spec, exc)
        return None, {"retrieval": "palabras", "embedding_error": str(exc)[:200]}
    return vector, {"retrieval": "hibrida", "embedding_model": embedder.spec, "embedded_chunks": embedded or None}


async def _semantic_ranking(vector: list[float] | None, spec: str, top_k: int, service_id: int | None = None) -> list[dict]:
    if vector is None:
        return []
    hits = await vector_search(vector, spec, top_k, service_id)
    return await chunks_by_ids([chunk_id for chunk_id, _ in hits], dict(hits))


async def gather_knowledge(
    lead: dict, messages: list[dict], instruction: str | None, catalog: list[dict],
    embedder: EmbeddingClient | None = None, *, follow_references: bool = True,
) -> tuple[list[dict], dict]:
    """Primero lo del servicio que le interesa al lead (su ficha es lo más
    útil y a veces la conversación todavía no dice nada buscable), después la
    búsqueda general. Cada etapa combina palabras y significado con RRF; sin
    embeddings, queda la búsqueda por palabras de siempre. Sin repetidos y
    dentro del presupuesto de caracteres. Devuelve también cómo se buscó, para
    el job."""
    seen: set[str] = set()
    knowledge: list[dict] = []

    def add(chunks: list[dict]) -> None:
        for chunk in chunks:
            if chunk["id"] not in seen:
                seen.add(chunk["id"])
                knowledge.append(chunk)

    vector, info = await _query_vector(embedder, semantic_query(lead, messages, instruction))
    spec = embedder.spec if embedder else ""

    service_id = service_id_for(lead, catalog)
    if service_id is not None:
        conversation = conversation_query(messages)
        lexical = await search_knowledge_chunks(conversation, SERVICE_TOP_K, service_id) if conversation else []
        semantic = await _semantic_ranking(vector, spec, SERVICE_TOP_K, service_id)
        found = fuse_rankings(lexical, semantic)[:SERVICE_TOP_K]
        add(found or await service_knowledge_chunks(service_id, SERVICE_TOP_K))

    lexical_lists = [await search_knowledge_chunks(query, KNOWLEDGE_TOP_K) for query in knowledge_queries(lead, messages, instruction)]
    if vector is None:
        for ranking in lexical_lists:
            add(ranking)
    else:
        semantic = await _semantic_ranking(vector, spec, KNOWLEDGE_TOP_K)
        add(fuse_rankings(*lexical_lists, semantic)[:GLOBAL_TOP_K])
    if follow_references:
        knowledge = await _with_references(knowledge)
    return _trim_knowledge(knowledge), info


async def _with_references(knowledge: list[dict]) -> list[dict]:
    """Cada ficha nombrada entra justo después del fragmento que la nombra:
    el mapa dice qué tratamiento corresponde y la ficha, a continuación, cómo
    es. Así también sobrevive al recorte por presupuesto."""
    following: dict[str, list[dict]] = {}
    for referrer, chunk in await referenced_chunks(knowledge, REFERENCE_TOP_K):
        following.setdefault(referrer, []).append(chunk)
    if not following:
        return knowledge
    ordered: list[dict] = []
    for chunk in knowledge:
        ordered.append(chunk)
        ordered.extend(following.get(chunk["id"], []))
    return ordered


def _trim_knowledge(chunks: list[dict]) -> list[dict]:
    kept, used = [], 0
    for chunk in chunks:
        size = len(chunk.get("content") or "")
        if used + size > KNOWLEDGE_MAX_CHARS and kept:
            break
        kept.append(chunk)
        used += size
    return kept


async def _models_for_tenant() -> list[tuple[str, str, dict]]:
    """``[(spec, api_key, sobrescrituras)]`` en orden: principal y, si tiene
    clave, secundario. Cada posición lleva los parámetros que el negocio
    configuró para ella; ``build_client`` descarta lo que el modelo no acepte."""
    values = await get_effective_many(SETTING_KEYS)
    chain: list[tuple[str, str, dict]] = []
    for slot, default in zip(("primary", "fallback"), default_models(values)):
        # Un modelo que el proveedor retiró se lee como su reemplazo: el
        # negocio no se queda sin sugerencias por no haber entrado a cambiarlo.
        spec = resolve_model_spec(values[f"ai_suggestions_{slot}_model"].strip() or default)
        if spec in [item[0] for item in chain]:
            continue
        provider, _ = parse_model_spec(spec)
        key = values[key_setting_for(provider)].strip()
        if key:
            chain.append((spec, key, parse_overrides(values[f"ai_suggestions_{slot}_params"])))
    return chain


class NativeAiProvider:
    def __init__(self, client_factory=build_client, embedder_factory=build_embedding_client) -> None:
        self._build = client_factory
        self._build_embedder = embedder_factory

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
        stages = await list_stages_for_ai()
        tz = await business_timezone()
        previous = await get_cached_suggestion(chat_id) if refresh else None

        # Los embeddings, con la clave del modelo principal: el mismo proveedor
        # para todo el conocimiento del negocio (vectores de modelos distintos
        # no se comparan).
        embedder = self._build_embedder(parse_model_spec(chain[0][0])[0], chain[0][1])
        knowledge, retrieval = await gather_knowledge(lead, messages, instruction, catalog, embedder)
        await record_ai_job_step(job_id, "knowledge_searched")

        now = datetime.now(tz)
        request = LlmRequest(
            system=load_system_prompt(),
            user=build_user_prompt(
                tenant_config=tenant_config, lead=lead, messages=messages, resources=resources,
                catalog=catalog, knowledge=knowledge, instruction=instruction, now=now, stages=stages, previous=previous,
            ),
            schema=SUGGESTION_SCHEMA,
            schema_name="sugerencias_copiloto",
        )

        errors: list[str] = []
        for spec, api_key, overrides in chain:
            client = self._build(spec, api_key, overrides)
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
                knowledge_retrieval=retrieval,
                failed_models=errors or None,
                # Con qué parámetros se generó: sin esto, un cambio en la
                # configuración del negocio no se puede relacionar con un
                # cambio en la calidad o el costo de las sugerencias.
                params=effective_params(spec, overrides),
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
