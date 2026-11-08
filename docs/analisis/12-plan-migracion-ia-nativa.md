# 12 · Plan: sugerencias y analista IA nativos (migración desde n8n)

Fecha: 2026-11-07. Estado: **fases 1 (copiloto de sugerencias) y 2 (conocimiento por servicio y PDF) implementadas**; el analista sigue en n8n por decisión del dueño.
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

### Historia: el índice de n8n y por qué estaba vacío

Antes de septiembre de 2026, `RAG1` era una herramienta *Supabase Vector Store*
sobre la tabla `documents`. Se llenaba con `utils/generar_chunks_rag.py` del repo
`algeronimo92/analisis-agentes-ia`: 68 fragmentos, **una sección markdown por
fragmento** (un dolor, una ficha, una objeción, un guion) a partir de cuatro fuentes
(`negocio/fichas-procedimientos.md`, `negocio/mapa-dolores-soluciones.md`,
`guias/playbook-objeciones.md`, `negocio/guiones-whatsapp.md`). Con multitenancy
(`1013998`, `5603f9d`) `RAG1` pasó a llamar `/api/webhooks/rag-search`, que busca en
`knowledge_chunks` del schema del negocio, pero el contenido de Supabase no se migró:
el copiloto quedó buscando en lo que cada negocio cargara a mano en *Conocimiento*.

Recuperación (2026-11-08):
- `chunk_text` respeta encabezados markdown: cada sección es su propio fragmento y
  lleva delante su ruta (`[ROSTRO Y PIEL › "Tengo manchas"]`). Es el criterio del
  generador original; un texto sin encabezados se sigue agrupando por párrafos.
- Ese contenido quedó en el repo como biblioteca de plantillas de plataforma,
  `backend/scripts/knowledge_templates/` (16 fichas, mapa dolor → solución, playbook
  de objeciones, guiones), y se publica con
  `python -m scripts.seed_knowledge_templates [--apply]` (idempotente por título).
  Se limpiaron los `[[enlaces]]` y las marcas `[VALIDAR…]`, y el nombre del negocio
  de origen quedó como `[NEGOCIO]`. Precios y datos operativos no son plantillas:
  el precio sale del catálogo y los datos del perfil del negocio. Cada negocio las
  importa y edita desde *Conocimiento › Plantillas*.
- El prompt del copiloto aclara que las cifras dentro de `<conocimiento>` (los
  guiones traen montos de ejemplo) son ilustrativas: el precio sale del catálogo.
- Límite que se mantiene: la búsqueda es léxica; "manchitas" no encuentra "manchas".
  Lo resuelve la fase 5 (embeddings).

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

## 6b. Lo implementado en la fase 1 (2026-11-07)

Diferencias con lo propuesto arriba, decididas al implementar:

- **Sin columna nueva en `organizations`**: el interruptor es el ajuste del negocio
  `ai_suggestions_mode` (`n8n` | `native`) en `app_settings`, que el admin activa desde
  la tarjeta "Asistente IA" de Integraciones cuando al menos una clave pasa la prueba.
  Ningún negocio cambia de comportamiento al desplegar: el valor por defecto es `n8n`.
- **Sin columnas nuevas en `ai_jobs`**: modelo, tokens, versión del prompt, fragmentos
  usados y modelos que fallaron van en `request_metadata` del job
  (`record_ai_job_metadata`). Alcanza para auditar y para medir costo en la fase 4.
- **Analista**: `RoutingAiProvider.analyze` siempre delega en n8n.
- **Catálogo cerrado de modelos** (`app/integrations/llm/catalog.py`): Gemini
  2.5 Flash/Pro y 2.0 Flash; OpenAI gpt-5.6-terra, gpt-5.5, gpt-5-mini y gpt-4.1-mini.
  Por defecto, el mismo par que hoy usa n8n.
- **Precarga de conocimiento** con consultas por *cualquiera* de las palabras
  significativas (`or_query`): una búsqueda que exigía todas las palabras no
  encontraba la ficha del servicio (lo detectó la prueba contra PostgreSQL).
- La prueba de conexión hace una llamada mínima al modelo elegido; "Probar y guardar"
  solo guarda una clave que respondió.

Archivos: `app/integrations/llm/*`, `app/modules/ai/infrastructure/{native_provider,routing_provider}.py`,
`app/modules/ai/prompts/copiloto.md`, `app/modules/ai/providers_service.py`,
`app/modules/ai/ai_access.py`, `app/composition.py`; frontend
`features/ai/components/AiIntegrationCard.tsx` y `app/IntegrationsPage.tsx`.
Pruebas: `tests/test_llm_clients.py`, `tests/test_native_copilot.py`,
`tests/test_native_copilot_postgres.py`, `AiIntegrationCard.test.tsx`.

Siguiente paso operativo: crear el clon de DermicaPro, cargar las claves reales,
activar el modo nativo solo allí y comparar 20 conversaciones contra n8n.

## 6c. Lo implementado en la fase 2 (2026-11-07)

- `knowledge_documents.service_id` (FK a `lead_services`, `SET NULL`; migración
  `e3f8a1c6d240`). Borrar un servicio deja sus documentos como generales.
- Tipo de documento cerrado: ficha, política, preguntas frecuentes, guion, otro.
- **Dónde se sube**: Asistente IA › Conocimiento, con selector de servicio y tipo, y
  filtro por servicio. En Catálogos cada servicio muestra "N fichas para la IA" o
  "Subir ficha para la IA", que abre el panel filtrado y crea el documento ya
  vinculado (`/ai-assistant?tab=knowledge&servicio=ID`).
- **PDF**: "Importar PDF, .txt o .md" extrae el texto en el backend (pypdfium2, ya
  instalada) y lo deja en el editor para revisarlo antes de guardar. Hasta 10 MB y
  200 páginas; un PDF escaneado se rechaza con aviso. El archivo viaja en base64
  porque el backend no acepta subidas multipart.
- **Búsqueda**: el título del documento también cuenta (una ficha "Hollywood Peel"
  aparece aunque el párrafo no repita el nombre); filtro opcional por servicio; sin
  consulta, los primeros fragmentos del servicio, fichas antes que FAQ.
- **Copiloto**: precarga hasta 4 fragmentos del servicio de interés del lead (por lo
  que dijo el cliente, o sus fichas si no hay coincidencias) y después la búsqueda
  general; el prompt indica el tipo de cada fragmento.
- La herramienta `rag-search` de n8n sigue igual (el filtro por servicio es opcional).

## 6d. Corte: las sugerencias dejan n8n (2026-11-08)

- Sin interruptor: las sugerencias las genera siempre el copiloto nativo con las
  claves del negocio. Se quitó `ai_suggestions_mode` (solo existió en esta rama).
- Un negocio sin una clave que funcione no tiene sugerencias: el chat muestra
  "carga la clave de tu proveedor en Integraciones › Sugerencias con IA".
- Retirados del backend: `call_n8n`, `N8nAiProvider.suggest`, los webhooks
  `/api/webhooks/rag-context` y `/rag-search`, la clave de plataforma
  `n8n_webhook_url` y el fixture `rag.json` con sus tests. `/api/webhooks/catalog`
  queda solo para el analista. `N8N_WEBHOOK_URL` sigue declarada en la config para
  que un `.env` viejo no impida arrancar, pero no se usa.
- El analista sigue en n8n sin cambios.
- Las 19 plantillas se publican solas al desplegar: la migración
  `b7d2f4a8c913` inserta las que falten por título (no pisa las editadas). El
  script `seed_knowledge_templates` queda para actualizar contenido después.
- Para producción, al desplegar: el admin de cada negocio carga y prueba su clave
  en Integraciones (hasta entonces no hay sugerencias) e importa sus plantillas.
  Después, el workflow de sugerencias de n8n se puede desactivar.

## 6e. Modelos: catálogo vigente y parámetros por modelo (2026-11-08)

Probado contra las APIs reales con claves de OpenAI y Gemini:

- La lista de modelos del proveedor no es fuente confiable: Gemini listaba
  `gemini-2.5-flash`/`2.5-pro`/`2.5-flash-lite` y respondía 404 "no longer
  available to new users"; `gemini-2.0-flash`, retirado. Responden JSON de
  sugerencias: `gemini-3.5-flash` (~7 s), `gemini-3.6-flash` (~8 s),
  `gemini-3.5-flash-lite` y `gemini-3.1-flash-lite` (~2 s). `3.1-pro` y `4-argon`
  piden un plan pago; `3.7`/`3.8-flash` no respondieron en 30 s.
- Catálogo nuevo: `gemini-3.6-flash` (principal por defecto), `gemini-3.5-flash-lite`
  y `gemini-3.1-flash-lite`. `gemini-3.5-flash` quedó afuera: Google lo deprecó y
  redirige sus pedidos a 3.6-flash.
  `RETIRED_MODELS` lleva lo guardado de un modelo retirado a su reemplazo al
  leerlo (no se puede guardar uno retirado).
- `MODEL_OPTIONS`: `reasoning_effort: low` solo en los gpt-5.x (gpt-4.1-mini
  responde 400 si se lo manda; sin fijarlo, gpt-5-mini gastó en razonar todo el
  presupuesto y devolvió vacío).
- Gemini con `safetySettings` en `OFF` explícito (el default de los 3.x; n8n los
  había relajado por bloqueos en temas clínicos); corte por
  longitud o bloqueo de seguridad (de ambos proveedores) falla con un error
  claro y pasa al secundario en vez de terminar como "JSON inválido".
- "Probar y guardar" valida la clave con la lista de modelos (no genera, no
  depende del modelo elegido).
- Pendiente (pasos 2 y 3 de la revisión): perfiles completos por modelo,
  prueba real de cada modelo con la clave del negocio, aviso de retiro en
  Integraciones y tiempo máximo total por sugerencia.

## 6f. Parámetros configurables por modelo (opción C: defaults de la plataforma, el negocio sobrescribe)

- **Registro de capacidades** (`app/integrations/llm/catalog.py`). Cada `ModelSpec`
  declara sus `ParamSpec`: tipo, rango o valores, default para el copiloto y
  reglas entre parámetros (`requires`). Por ejemplo, temperature, top_p y las
  penalizaciones en gpt-5.x solo valen con `reasoning="none"`. Sale de pruebas
  contra las APIs, no de la documentación: OpenAI documentaba `reasoning="max"`
  para gpt-5.6 y `stop` para GPT-5, y la API rechaza los dos.
- **Nombres neutrales** (`reasoning`, `max_output_tokens`, `verbosity`, `stop`,
  `seed`, `timeout_seconds`…). Cada adaptador los traduce a su API:
  - `reasoning` → `reasoning_effort` en OpenAI, `thinkingConfig.thinkingLevel` en Gemini;
  - `max_output_tokens` → `max_completion_tokens` / `maxOutputTokens`.
- **Sobrescrituras del negocio** por posición: `ai_suggestions_{primary,fallback}_params`
  (JSON).
  - **Al guardar:** se validan contra el modelo de esa posición. Si cambia el
    modelo, lo que el nuevo no acepta se descarta.
  - **Al usar:** `effective_params` = defaults + sobrescrituras válidas. El job
    guarda los `params` efectivos para auditar costo y calidad.
- **UI:** "Configuración avanzada", plegable, en la tarjeta de Integraciones. El
  formulario se arma desde el esquema que manda el backend, así que un modelo
  nuevo no requiere tocar el frontend.
- **`python -m scripts.probe_llm_params`:** repite las pruebas contra las APIs con
  `OPENAI_API_KEY` y `GEMINI_API_KEY`, y falla si el registro dice que se acepta
  algo que la API rechaza. Se corre al agregar un modelo y de vez en cuando.
- **Pendiente:**
  - verificar los parámetros nativos de Gemini (`thinkingLevel`) con una clave
    en `x-goog-api-key`;
  - pasar Gemini de `responseSchema` (deprecado) a `responseJsonSchema`;
  - tiempo máximo total por sugerencia.

## 6g. Búsqueda del conocimiento: híbrida y con las fichas que se nombran (2026-11-08)

**Problema.** Al pasar a nativo, la búsqueda quedó solo por palabras (`ts_rank_cd` en
español). El índice de n8n usaba embeddings. El cliente habla de su problema ("tengo la
cara caída", "paño") y la ficha del tratamiento ("flacidez", "melasma"): las palabras no
coinciden.

**Medición** (`python -m scripts.eval_knowledge_retrieval --schema <tenant>`). Son 32 casos
de `scripts/knowledge_eval_cases.json` sobre la biblioteca de 19 plantillas, sin servicio
de interés. Cuenta como acierto que la ficha esperada entre al contexto que recibe el modelo.

| Modo | OpenAI `text-embedding-3-small` | Gemini `gemini-embedding-2` |
|---|---|---|
| Solo palabras (lo anterior) | 22/32 (69%) | 22/32 (69%) |
| Palabras + fichas nombradas | 26/32 (81%) | 26/32 (81%) |
| Híbrida | 23/32 (72%) | 23/32 (72%) |
| **Híbrida + fichas nombradas** | **31/32 (97%)** | **29/32 (91%)** |

**Lo que se aprendió.**
- La búsqueda por significado sola aporta poco. La biblioteca ya trae un "Mapa dolor → solución"
  con las frases de los clientes, y eso lo encuentran las dos búsquedas.
- El hueco era otro: llegaba la entrada del mapa ("paño → **Ácido tranexámico**") pero no la
  ficha, que trae contraindicaciones y cuidados. Hace falta un segundo salto.

**Qué se implementó.**
- **Embeddings** en `knowledge_chunks.embedding` (`REAL[]`), junto con `embedding_model`, el
  modelo que generó cada vector.
  - No se usa pgvector: la imagen de producción (`postgres:16.14-alpine`) no lo trae, y cambiar
    la imagen de la base es una operación manual en el servidor.
  - Un negocio tiene a lo sumo unos miles de fragmentos. La similitud se calcula con numpy contra
    una matriz en memoria por schema, que se recarga cuando cambian los fragmentos.
- **Clientes de embeddings.** OpenAI y Gemini usan el mismo endpoint `/embeddings` (el de Gemini es
  su endpoint compatible con OpenAI), con 768 dimensiones y la clave del modelo principal del negocio.
- **Vectores tardíos.** Se calculan en la sugerencia siguiente al guardar o importar, hasta 200 por
  sugerencia, no al guardar. Así guardar no depende de la API, y el mismo camino cubre el despliegue
  y el cambio de proveedor.
- **Fusión con RRF (k=60).** Cada etapa (servicio de interés y búsqueda general) combina palabras y
  significado con Reciprocal Rank Fusion.
- **Si los embeddings fallan**, la sugerencia sigue solo por palabras. El job anota
  `knowledge_retrieval` (`hibrida`/`palabras`, el error si lo hubo, cuántos vectores calculó).
- **Fichas nombradas.** Si un fragmento encontrado nombra el título de otro documento ("Ficha:
  Ácido Tranexámico" → "acido tranexamico", sin tildes ni mayúsculas), entra el primer fragmento
  de ese documento justo después, hasta 3.
- **Desempate estable.** La búsqueda por palabras desempataba por un id aleatorio: dos corridas
  iguales armaban contextos distintos. Ahora desempata por título y orden.
- **Costo.** Una llamada de embeddings por sugerencia (~0,4 s; centavos por mes). La generación sigue
  dominando (~8 s).

**Pendiente.**
- Sumar casos de conversaciones reales a la medición.
- Rerankeo, solo si la medición lo justifica.
- Pasar a pgvector si un negocio llega a cientos de miles de fragmentos.

## 7. Decisiones tomadas y pendientes

Tomadas (2026-11-07):
1. Proveedor principal y secundario seleccionables, como en n8n; el secundario entra
   solo si el principal falla.
2. Claves por API key, cargadas por el admin de cada negocio en Integraciones cuando
   quiera activar las sugerencias; cifradas por tenant, con prueba de conexión.
3. La comparación de la fase 1 se hace sobre un clon de DermicaPro.

4. El analista sigue en n8n; la fase 3 queda fuera de alcance por ahora.

Pendientes:
1. Comparar en el clon de DermicaPro con claves reales y fichas cargadas.
2. Fase 4 (costo por negocio en el panel de plataforma) cuando haya datos de uso.

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
