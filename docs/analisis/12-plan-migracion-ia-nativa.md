# 12 · Plan: sugerencias y analista IA nativos (migración desde n8n)

Fecha: 2026-11-07. Estado: **propuesto, pendiente de aprobación**.
Rama de trabajo: `claude/dazzling-rubin-h2elal` (ya contiene paquetes por servicio,
sincronización con el ERP, compras del lead e Integraciones, que este plan usa).

## 1. Punto de partida

Hoy la IA del CRM corre en dos workflows de n8n (exports saneados en
`backend/tests/fixtures/n8n/rag.json` y `analista.json`). n8n **no guarda datos**:
cada ejecución recibe un job firmado por el CRM y vuelve a llamarlo por tres puertas
(`/api/webhooks/rag-context`, `/api/webhooks/rag-search`, `/api/webhooks/catalog`)
para obtener lead, mensajes, recursos, perfil, conocimiento y catálogo. Lo único que
n8n aporta es la orquestación del modelo:

| Pieza del workflow | Hoy | En el CRM |
|---|---|---|
| Job, token de tenant, revisión de contexto | n8n valida lo que el CRM le mandó | `app/modules/ai/ai_jobs.py`, `ai_job_tokens.py` (existe) |
| Contexto del lead, mensajes, recursos, perfil | n8n lo pide al CRM | `ai_context.fetch_analysis_context` (existe) |
| Catálogo de precios (herramienta `precios1`) | n8n lo pide al CRM | `ai_assistant_service.list_ai_catalog` (existe; ahora con **paquetes**) |
| Búsqueda de conocimiento (herramienta `RAG1`) | n8n la pide al CRM | `knowledge_search.search_knowledge_chunks` (existe; FTS español) |
| Agente, prompt de sistema, modelo, reintentos | **n8n** | *por hacer* |
| Salida estructurada + autoarreglo de JSON | **n8n** (parser con gpt-5.5) | esquema Pydantic existe (`schemas.SuggestionResponse`) |
| Aplicar análisis al lead | n8n llama a `/api/webhooks/analysis-apply` | `ai_jobs.apply_analysis_job_atomic` (existe) |

Modelos del workflow de sugerencias: **Gemini 2.5 Flash** como principal (entrada 0
del agente), **OpenAI gpt-5.6-terra** como respaldo (entrada 1), **gpt-5.5** para
arreglar JSON inválido. Opciones: 8.000 tokens de salida, razonamiento bajo, 60 s,
2 reintentos. Analista: gpt-4.1-mini con Gemini de respaldo.

El corte ya existe en el código: `app/modules/ai/application/ports.py` define
`AiProvider` (`suggest`, `analyze`) y `app/composition.py` conecta hoy
`N8nAiProvider`. Migrar es **escribir una segunda implementación** y elegirla por
negocio.

## 2. Objetivos y no-objetivos

Objetivos:
1. Generar sugerencias y análisis sin salir del backend, con la misma calidad que hoy.
2. Migrar negocio por negocio, con comparación lado a lado y vuelta atrás inmediata.
3. Que el catálogo con paquetes y las compras del lead formen parte del prompt.
4. Permitir conocimiento por servicio (fichas, protocolos, objeciones) y ficheros PDF.
5. Dejar n8n solo para citas (`FORM-NUEVAS-CITAS`), que no es parte de este plan.

No-objetivos (por ahora):
- Embeddings y pgvector. La búsqueda léxica actual cubre fichas, políticas y guiones;
  se reevalúa en la fase 5 con datos de uso. Instalar la extensión exige permisos en el
  servidor de PostgreSQL que ya dieron problemas (`_detect_search_capabilities`).
- Cambiar el contrato con el frontend (`SuggestionResponse`, `SuggestionStatus`,
  `LeadAnalysisResult`): la UI no se toca en las fases 1 a 3.
- Reescribir n8n. Los workflows actuales siguen intactos como respaldo.

## 3. Decisiones de diseño

1. **Proveedores seleccionables, principal y secundario**, como en el agente de n8n.
   Un puerto `LlmClient` (`complete_structured(system, user, schema, tools)`) con un
   adaptador por proveedor en `app/integrations/llm/{gemini,openai}.py` (ampliable a
   otros). En el panel de plataforma se eligen el **proveedor y modelo principal** y
   el **secundario**; el secundario entra solo cuando el principal falla (error de
   red, cuota, respuesta inválida tras un reintento). Cada job guarda qué modelo
   respondió. La salida estructurada nativa de cada proveedor reemplaza al parser con
   autoarreglo del workflow.
2. **Claves por API key, cargadas por el admin de cada negocio** en Integraciones
   (`app_settings` del tenant, cifradas como el token de Meta): `gemini_api_key`,
   `openai_api_key`, más `ai_primary_model` y `ai_fallback_model` (valores
   `proveedor:modelo`, p. ej. `gemini:gemini-2.5-flash`, `openai:gpt-5.6-terra`).
   Nueva tarjeta **"Asistente IA"** en Integraciones: clave por proveedor con
   "Probar conexión" (una llamada mínima que confirma que la clave y el modelo
   responden), selector de modelo principal y secundario, y estado: *Sin configurar*
   mientras no haya clave válida. Cada negocio paga su propio consumo; la plataforma
   conserva el permiso (`ai_enabled`) y la cuota mensual de jobs. Un negocio con
   `ai_provider = native` y sin clave válida ve en el chat el aviso "Asistente IA no
   conectado" con enlace a Integraciones, como las demás integraciones.
3. **Interruptor por negocio**: columna `organizations.ai_provider`
   (`'n8n' | 'native'`, default `'n8n'`), editable desde el panel de plataforma junto a
   `ai_enabled` y la cuota. `composition.py` conecta un `RoutingAiProvider` que lee la
   columna en cada llamada y delega. Sin tenant (instalación single-tenant), manda la
   variable `AI_PROVIDER`.
4. **Catálogo inyectado, conocimiento como herramienta**. El catálogo es pequeño y
   autoritativo: va completo en el prompt (servicio, descripción, paquetes con sesiones
   y precio total, notas; más las compras previas del lead). El conocimiento sigue
   siendo una herramienta `buscar_conocimiento(query)` que el modelo invoca, con una
   primera pasada precargada a partir de los últimos 3 mensajes del cliente y el
   servicio de interés, para que la mayoría de las generaciones resuelvan en una sola
   vuelta.
5. **Mismos jobs, misma auditoría**. El proveedor nativo registra los mismos pasos
   (`context_loaded`, `knowledge_searched`) que hoy exige `suggest_reply`, así las
   comprobaciones de aislamiento y la caché por revisión de contexto siguen valiendo.
6. **Prompts versionados en el repo**: `app/modules/ai/prompts/{copiloto,analista}.md`,
   portados del workflow y ajustados a paquetes y compras. Cada job guarda la versión
   del prompt y el modelo que respondió en `request_metadata`.
7. **Costo y cuota**: la cuota mensual sigue contando jobs. Se añade al job
   `tokens_in`, `tokens_out` y `model` para medir costo por negocio desde el panel de
   plataforma (fase 4).

## 3b. Conocimiento: dónde se sube y cómo se construye el RAG

### Hoy

- **Dónde se sube**: Asistente IA › pestaña *Conocimiento* (`features/ai`). Cada
  documento tiene título y texto (hasta 100.000 caracteres); se escribe a mano o se
  importa un `.txt`/`.md`. Máximo 200 documentos por negocio. Son generales: no se
  asocian a un servicio.
- **Cómo se indexa** (`knowledge_service.chunk_text`): al guardar, el texto se parte
  por párrafos en fragmentos de ~1.200 caracteres con 150 de solapamiento (un párrafo
  más largo se corta por oraciones). Los fragmentos van a `knowledge_chunks` con un
  índice GIN de texto completo en español (`to_tsvector('spanish')`). Editar el
  documento regenera todos sus fragmentos.
- **Cómo se recupera** (`knowledge_search.search_knowledge_chunks`): la consulta que
  formula el modelo se convierte con `websearch_to_tsquery('spanish')`; se rankean
  los fragmentos por `ts_rank_cd` y se devuelven los 5 mejores con título y fuente.
  Si no hay coincidencia léxica, cae a `ILIKE` sobre contenido y título.
- **Qué más entra al prompt sin pasar por el RAG**: el perfil del negocio (qué
  ofrece, ubicación, horarios, moneda, tono, reglas "siempre"/"nunca"), el catálogo con
  paquetes, las compras del lead y los archivos de la biblioteca marcados como
  adjuntables con su descripción.

### Lo que cambia con el plan

- **Dónde se sube** (fase 2):
  - Catálogos › servicio › *Fichas y materiales*: documentos vinculados a ese
    servicio (ficha clínica, protocolo, contraindicaciones, preguntas frecuentes,
    objeciones típicas, guion de cierre). Es el lugar natural: quien carga precios
    carga también lo que la IA debe saber del servicio.
  - Asistente IA › Conocimiento sigue para lo transversal: políticas de pago y
    cancelación, garantías, ubicación, promociones vigentes. Gana un selector
    opcional de servicio y un tipo de documento (ficha, política, FAQ, guion).
  - Formatos: `.txt`, `.md` y **PDF con texto extraíble** (sin OCR; un PDF escaneado
    se rechaza con aviso). El ERP no trae descripciones, así que no hay sincronización
    de fichas desde allí.
- **Cómo se indexa**: mismo troceado; cada fragmento guarda en `metadata`
  `service_id`, `service_name` y `document_type`, y el título del documento se
  antepone al contenido del fragmento al indexar, para que una ficha "Hollywood Peel"
  se encuentre aunque el párrafo no repita el nombre.
- **Cómo se recupera** (fase 1 y 2), en este orden:
  1. *Precarga*: antes de llamar al modelo, consulta armada con el servicio de
     interés del lead más los últimos 3 mensajes del cliente. Primero fragmentos del
     servicio de interés (hasta 4), luego el resto (hasta 4). Entra al prompt como
     sección `<conocimiento>` con título y fuente de cada fragmento.
  2. *Herramienta* `buscar_conocimiento(query, servicio?)`: el modelo la invoca si
     necesita algo que no estaba precargado (máximo 3 llamadas por generación);
     misma búsqueda léxica, misma prioridad por servicio.
  3. *Presupuesto*: el prompt reserva un máximo de caracteres para conocimiento;
     si se excede, se recortan los fragmentos de menor ranking, nunca el catálogo ni
     el historial reciente.
  4. *Trazabilidad*: el job guarda qué fragmentos entraron (ids) para auditar por qué
     la IA dijo lo que dijo.
- **Embeddings** quedan para la fase 5: el troceado y los metadatos ya quedan listos
  para añadir una columna vectorial sin reindexar a mano.

## 4. Fases

### Fase 0 · Preparación (sin cambio funcional)

- Tests de caracterización del proveedor actual: grabar 5 conversaciones de prueba
  (fixtures) con la respuesta JSON esperada para comparar nativo contra n8n.
- `LlmClient` y adaptadores Gemini/OpenAI con pruebas contra dobles HTTP.
- Tarjeta "Asistente IA" en Integraciones: clave por proveedor, selección de modelo
  principal y secundario, "Probar conexión" por proveedor (llamada mínima al modelo).
  `SETTING_DEFS` crece con cuatro entradas del grupo `ai`.
- Migración Alembic: `organizations.ai_provider` (plano de control) y
  `ai_jobs.model`, `tokens_in`, `tokens_out`, `prompt_version` (plano tenant).

Entregable: el admin del negocio puede cargar sus claves y probarlas; las sugerencias siguen saliendo por n8n hasta la fase 1.

### Fase 1 · Sugerencias nativas con interruptor

- `app/modules/ai/infrastructure/native_provider.py`: `NativeAiProvider.suggest`.
  1. Carga `fetch_analysis_context` (lead, mensajes, recursos, perfil, compras) y
     registra `context_loaded`.
  2. Carga el catálogo con paquetes y lo serializa compacto.
  3. Precarga conocimiento: consulta formada por últimos mensajes del cliente y
     `servicio_interes`; registra `knowledge_searched`.
  4. Arma el prompt (`prompts/copiloto.md`) con las mismas secciones del workflow:
     negocio, lead, datos temporales, recursos, historial, indicación del vendedor, y
     las nuevas: catálogo y compras.
  5. Llama a `LlmClient` con la herramienta `buscar_conocimiento`; máximo 3 vueltas.
  6. Valida contra `SuggestionResponse`; en fallo, un reintento con el error; luego el
     modelo de respaldo.
- `RoutingAiProvider` + columna `ai_provider` + edición desde el panel de plataforma.
- Pruebas: unitarias con dobles de `LlmClient` (aislamiento, pasos registrados, uso de
  paquetes y compras en el prompt, adjuntos solo de recursos autorizados, respaldo),
  y una contra Postgres real con un tenant provisionado.
- Métrica mínima: duración y modelo por job, en el log estructurado.

Entregable: con `ai_provider = native` un negocio recibe sugerencias sin n8n. Se
activa primero en un **clon de DermicaPro** (organización nueva con copia del
catálogo, el conocimiento y 20 conversaciones representativas) y se comparan las
generaciones contra n8n con las mismas conversaciones.

### Fase 2 · Conocimiento por servicio y PDF

- `knowledge_documents.service_id` (FK a `lead_services`, `SET NULL`) + índice.
- Catálogos › servicio: "Fichas y materiales" con los documentos vinculados y alta
  directa. Asistente IA › documentos: selector de servicio opcional.
- Importar PDF (texto extraíble; sin OCR) además de `.txt`/`.md`; límite de 100.000
  caracteres por documento ya existente. Tipo de documento (ficha, política, FAQ,
  guion) como metadato.
- Recuperación según la sección 3b: precarga por servicio de interés, herramienta
  con filtro opcional por servicio, presupuesto de caracteres y trazabilidad de
  fragmentos en el job.
- Prompt: "si el lead ya compró X, no lo cotices de nuevo; propone lo complementario".

Entregable: el negocio sube por servicio lo que la IA debe saber; la calidad de las
sugerencias deja de depender de la descripción corta del catálogo.

### Fase 3 · Analista nativo

- `NativeAiProvider.analyze`: mismo contexto, etapas del negocio en el prompt
  (`prompts/analista.md`), salida validada (`estado` debe ser una etapa activa,
  `tipo_objecion` en su enumeración, fechas ISO), aplicación con
  `apply_analysis_job_atomic` dentro del mismo proceso.
- Mismas reglas que hoy: el analista no mueve a etapas inactivas ni inventa razones;
  el silencio lo manejan las automatizaciones.

Entregable: el negocio migrado no depende de n8n para nada de IA.

### Fase 4 · Operación y apagado de n8n

- Panel de plataforma: por negocio, proveedor, modelo, jobs del mes, tokens y costo
  estimado; errores recientes.
- Migrar los negocios restantes; dejar `n8n_webhook_url`/`n8n_analyst_webhook_url`
  vacíos; marcar `N8nAiProvider` como obsoleto (se borra en un PR posterior).
- Actualizar `docs/10-workflows-n8n-meta-multitenant.md` y CLAUDE.md ("n8n solo para
  citas").

### Fase 5 · Opcional, con datos: recuperación híbrida

Solo si las métricas de la fase 4 muestran consultas sin resultados léxicos:
embeddings por fragmento (proveedor ya configurado), `pgvector` en el servidor,
búsqueda híbrida (léxica + vectorial, fusión por rango). Diseño aparte.

## 5. Archivos que toca cada fase

| Fase | Backend | Frontend |
|---|---|---|
| 0 | `app/integrations/llm/*`, `app/modules/platform/settings_service.py` (grupo `ai`), migración control+tenant, `app/db/models/{control,ai}.py` | tarjeta "Asistente IA" en Integraciones (`features/platform/components/`): claves, modelos y prueba |
| 1 | `app/modules/ai/infrastructure/{native_provider,routing_provider}.py`, `app/modules/ai/prompts/`, `app/composition.py`, `app/modules/ai/ai_assistant_service.py` (catálogo compacto) | panel de plataforma: selector de proveedor por negocio |
| 2 | migración `knowledge_documents.service_id`, `knowledge_service.py` (PDF), `knowledge_search.py` (filtro por servicio), `assistant_api.py` | `features/ai` (selector de servicio, PDF), `features/catalogs` (fichas por servicio) |
| 3 | `native_provider.analyze`, `prompts/analista.md` | — |
| 4 | métricas en `ai_jobs`, panel | panel de plataforma |

Reglas de arquitectura a respetar (las imponen tests): `app/integrations/llm` no
importa módulos salvo por `ports`/`public`; `application/` del módulo `ai` solo habla
con `ports/`; httpx solo en integraciones o archivos fuera de `domain/`/`application/`;
`FOREIGN_TABLES` no crece (el proveedor nativo lee por `ai_context` y
`ai_assistant_service`, que ya tienen permiso).

## 6. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Calidad distinta a n8n | Fixtures de caracterización; comparación en negocio de prueba; interruptor por negocio |
| Un proveedor caído | Respaldo automático al segundo modelo; si ambos fallan, el job queda `failed` como hoy |
| Negocio nativo sin clave o con clave vencida | Estado "Con error" en la tarjeta, aviso en el chat con enlace a Integraciones; el job no se crea ni consume cuota |
| Prompt sin aislamiento entre negocios | Mismos jobs firmados y pasos obligatorios; tests que verifican que el prompt solo contiene datos del tenant |
| Costo sin control | Tokens por job y tope mensual existente; alerta en panel al 80 % |
| Catálogo grande en otro negocio | Si supera ~150 servicios, el catálogo pasa a herramienta con búsqueda por nombre (interruptor por tamaño, no por negocio) |
| PDF con texto no extraíble | Se rechaza con mensaje claro; OCR fuera de alcance |

## 7. Decisiones tomadas y pendientes

Tomadas (2026-11-07):
1. Proveedor principal y secundario seleccionables, como en n8n; el secundario entra
   solo si el principal falla.
2. Claves por API key, cargadas por el admin de cada negocio en Integraciones cuando
   quiera activar las sugerencias; cifradas por tenant, con prueba de conexión.
3. La comparación de la fase 1 se hace sobre un clon de DermicaPro.

Pendientes:
1. Si la fase 2 va antes que la 3. Recomendación: sí, porque mejora las sugerencias
   que el equipo usa a diario; el analista hoy funciona y puede esperar.

## 8. Orden y tamaño

| Fase | Tamaño relativo | Dependencias |
|---|---|---|
| 0 | M | claves de plataforma |
| 1 | L | fase 0 |
| 2 | M | fase 1 (para medir el efecto) |
| 3 | M | fase 1 |
| 4 | S | fases 1 y 3 |
| 5 | L | datos de la fase 4 |

Cada fase es un PR propio con sus tests; ninguna cambia el contrato del frontend salvo
la 2 (tipos regenerados en el mismo PR).
