# 08 - Análisis de latencia: endpoints y servicios externos

Estado: COMPLETO

Metodología: revisión estática de código. Nada de lo que aparece aquí procede de
mediciones en runtime salvo que se marque explícitamente como MEDIDO. Todo lo
demás es INFERIDO por lectura de código o ESTIMACIÓN razonada (marcada como tal,
con el razonamiento explícito). No se arrancó ningún servicio ni se ejecutó
ninguna consulta contra PostgreSQL.

Contexto ya establecido por análisis previos y que aquí no se repite:
`db_service.py` como módulo monolítico, el bug de `fetch_messages` reteniendo la
conexión mientras descarga de MinIO, y el `dict` en memoria de `ws_manager.py`.

---

## 1. Inventario de endpoints

Routers en `backend/routers/` (19 módulos). Todos se montan en
`backend/main.py:256-279`. Los del **camino crítico** están marcados con [CC].

| Router | Prefijo | Endpoints relevantes | Auth |
|---|---|---|---|
| `auth.py` | `/api/auth` | login, logout, me | pública/cookie |
| `users.py` | `/api/users` | CRUD usuarios | admin |
| `chats.py` | `/api/chats` | [CC] `GET ""`, `GET /unread-count`, `GET /kanban/{counts,snapshot,stage}`, `GET /{id}`, [CC] `GET /{id}/messages`, `GET /{id}/activity`, `GET /{id}/service-window`, `GET /{id}/history`, [CC] `POST /{id}/messages`, `POST /{id}/{audio,media,sticker,location}`, `POST /{id}/templates/{tid}`, `POST /{id}/read`, `PATCH /{id}`, `PATCH /{id}/stage` | cookie (router-level) |
| `suggestions.py` | `/api/suggestions` | `GET /{chat_id}` (cache), `POST ""` (llama n8n **en el request**) | cookie |
| `tts.py` | `/api/tts` | síntesis ElevenLabs **en el request** | cookie |
| `settings.py` | `/api/settings` | listar/guardar | admin |
| `whatsapp.py` | `/api/whatsapp` | estado, QR, logout (proxy Evolution) | admin |
| `tags.py` | `/api/tags` | CRUD etiquetas | cookie |
| `tasks.py` | `/api/tasks` | [CC] `GET ""`, `POST`, `PATCH /{id}` | cookie |
| `scheduled_messages.py` | `/api/scheduled-messages` | listar/crear/cancelar | cookie |
| `templates.py` | `/api/templates` | [CC] listado con adjuntos + estado por usuario | cookie |
| `media_library.py` | `/api/media-library` | listado/alta/baja de assets | cookie |
| `internal_notes.py` | `/api/leads/{id}/notes` | notas + menciones | cookie |
| `notifications.py` | `/api/notifications` | listado + marcar leídas | cookie |
| `dashboard.py` | `/api/dashboard` | [CC] `GET /metrics` | cookie |
| `automations.py` | `/api/automations` | reglas, flujos, ejecuciones | cookie/admin |
| `webhooks.py` | `/api/webhooks` | entradas de n8n/Evolution | token |
| `media.py` | `/api/media/upload` + [CC] `GET /media/{filename}` | subida (n8n) y **proxy de descarga** | token / cookie |

Observaciones de inventario:

- El único middleware HTTP es `add_performance_headers`
  (`backend/main.py:225-246`): añade `Server-Timing` y `X-DB-Queries`, y loguea
  como "Slow request" todo lo que pase de 1000 ms. Es la única instrumentación
  de latencia existente y **no persiste percentiles** (ver sección 9).
- La autenticación por cookie no pega a la base en cada request: `_cached_user`
  cachea el usuario en memoria con TTL (`backend/services/auth_service.py:47-67`).
  Bien resuelto.
- `GET /media/{filename}` está declarado como `def` síncrono
  (`backend/routers/media.py:162`), así que FastAPI lo ejecuta en el threadpool
  y no bloquea el event loop. Correcto, pero consume un hilo del pool por
  descarga concurrente (ver sección 5).

---

## 2. Camino crítico: coste por endpoint

### 2.1 `GET /api/chats` — listado de chats (`routers/chats.py:217`, `db_service.py:399-500`)

Consultas por request: **2** (la principal + `_tags_by_lead`). El problema no es
el número sino la forma de la principal.

La consulta arma, por cada lead candidato:

- Un `LATERAL` que busca el último mensaje (`_last_message_subquery`,
  `db_service.py:137-152`).
- Un subquery escalar correlacionado `COUNT(*)` de mensajes no leídos
  (`_unread_count_subquery`, `db_service.py:155-167`).
- Otro subquery escalar correlacionado `MAX(sent_at)` del último mensaje de
  cliente (`_last_customer_message_at_subquery`, `db_service.py:183-189`).

Los tres están en la lista de columnas (`_chat_columns`, `db_service.py:349-375`)
y la consulta **no acota previamente el conjunto de leads**: el `ORDER BY` es
`last_message.sent_at DESC NULLS LAST, leads.id DESC`, es decir, sobre una
columna derivada del LATERAL. PostgreSQL no puede usar un índice para ese orden,
así que tiene que materializar la fila de todos los leads que pasen los filtros
y luego ordenar, para devolver 30.

INFERIDO: sin búsqueda ni filtros, el coste es del orden de `3 × N_leads`
accesos por índice a `wsp_messages` más un sort de N filas, para devolver
`CHATS_PAGE_SIZE = 30`. ESTIMACIÓN: con 2.000 leads son ~6.000 index scans por
carga del listado; con 10.000 leads, ~30.000. Es el endpoint que se llama al
abrir la app y en cada invalidación por WebSocket, así que multiplica por número
de vendedores conectados. **Este es el cuello de botella número uno del backend.**

Agravantes:

- La paginación por keyset (`_cursor_condition`, `db_service.py:378-396`) evita
  el `OFFSET` pero **no reduce el trabajo**: el predicado del cursor se aplica
  sobre `last_message.c.sent_at`, que solo existe tras ejecutar el LATERAL. Cada
  página siguiente vuelve a recorrer todos los leads.
- Con `search`, se añaden dos subqueries escalares más
  (`_matched_message_subquery`, `db_service.py:322-346`) y la expresión de rango
  (`_search_rank_expression`, `db_service.py:310-319`) **se evalúa hasta tres
  veces**: en la lista de columnas (línea 421), en el `ORDER BY` (línea 488) y en
  el predicado del cursor (línea 476). SQLAlchemy no comparte la subexpresión, se
  emite tres veces en el SQL. Y `_identity_conditions` incluye
  `regexp_replace(Lead.telefono, '\D','','g') LIKE ...` (línea 248), que no tiene
  índice de expresión: seq scan garantizado sobre `leads` en cada búsqueda por
  número.
- El filtro `waiting_time` y `last_sender` (líneas 450-468) se aplican sobre
  `last_message.c.sender` / `.sent_at`, otra vez columnas derivadas: se calcula
  el LATERAL para todos y se descarta después.

### 2.2 `GET /api/chats/{id}/messages` — apertura de conversación (`db_service.py:1331-1433`)

Consultas: **2 a 4** (la página, `_fill_media_dimensions` opcional,
`_resolve_quoted_messages` opcional, más 2 extra si viene `until_id`).

- La consulta principal usa `idx_wsp_messages_chat_cursor`
  `(chat_id, sent_at DESC, id DESC)`: es la única del camino crítico que está
  bien indexada.
- `until_id` (abrir un chat desde un resultado de búsqueda) hace un `COUNT(*)`
  del tramo (línea 1360) y luego amplía `limit` hasta
  `JUMP_TO_MESSAGE_MAX = 1000` (`db_service.py:1328`). Un chat largo puede
  devolver **hasta 1.000 mensajes en una sola respuesta**, con sus
  `analysis`/`payload`/`reactions` JSONB completos. ESTIMACIÓN: a ~2 KB por
  mensaje con análisis IA, del orden de 2 MB de JSON en un único GET.
- `_fill_media_dimensions` (`db_service.py:1689-1737`) es el punto ya reportado:
  descarga cabeceras desde MinIO (hasta 6 en paralelo) **con la sesión de
  PostgreSQL abierta**. Aparte del riesgo de pool, añade a la latencia del GET el
  RTT a MinIO de hasta `ceil(pendientes/6)` tandas. Solo ocurre la primera vez
  que se abre cada mensaje con imagen/video, pero eso significa que el primer
  scroll por un historial nuevo es sistemáticamente lento.

### 2.3 `POST /api/chats/{id}/messages` — envío de texto (`routers/chats.py:508-517`)

Bien diseñado: **no** llama a Evolution dentro del request. Coste:
`lead_exists` (1), `fetch_reply_target` (1 si hay cita), `enqueue_messages`
(1 transacción con 2 INSERT), `manager.broadcast` (fan-out). Total 2-3
consultas. El envío real lo hace `watch_message_outbox`
(`services/message_outbox.py:511`).

Comparación con los envíos que **sí** son síncronos:

- `POST /{id}/sticker` (`routers/chats.py:583-616`): lee de MinIO, convierte con
  PIL y llama a `send_whatsapp_sticker` con timeout 60 s, todo dentro del
  request. Si Evolution está lenta, el vendedor espera hasta un minuto.
- `POST /{id}/messages/{mid}/reaction` (`routers/chats.py:738-765`): llama a
  Evolution con timeout 30 s antes de persistir. Es una decisión deliberada y
  documentada, pero es latencia de externo en el request.
- `POST /{id}/audio` y `POST /{id}/media` (`routers/chats.py:520-580`):
  decodifican base64 y suben a MinIO con `asyncio.to_thread` (correcto), pero
  el archivo viaja **en base64 dentro del JSON**, lo que infla ~33 % la subida y
  obliga a materializar hasta 25 MB en memoria del proceso (`MAX_BYTES`,
  `routers/media.py:39`). Con vídeo, `save_media_file` puede además invocar
  `ffmpeg` con timeout de **300 s** (`services/media_storage.py:280-332`) dentro
  del threadpool, ocupando un hilo del executor durante minutos.

### 2.4 `POST /api/chats/{id}/read` (`routers/chats.py:768-791`)

Llama a `mark_messages_as_read` de Evolution **dentro del request**, con timeout
30 s. Es best-effort en cuanto a errores, pero no en cuanto a tiempo: si
Evolution tarda 30 s, el usuario ve el chat marcado como leído 30 s después. Se
dispara al abrir cada conversación, así que está en el camino crítico más
transitado. Debería ir a una tarea de fondo.

### 2.5 `PATCH /api/chats/{id}` y `POST /api/chats` (`routers/chats.py:330-419`)

Ambos llaman a `_verify_whatsapp_number` → `check_whatsapp_numbers` (Evolution,
timeout 10 s) en el request. Además `create_lead` y `update_lead` terminan
llamando a `fetch_chat`, que reejecuta el LATERAL + subqueries del listado para
un solo lead (barato en ese caso, pero son consultas extra).

`update_lead` (`db_service.py:908-952`) abre sesión, hace `SELECT ... FOR UPDATE`,
`UPDATE`, `INSERT` en `lead_activity`, commit, **cierra la sesión y abre otra**
para `fetch_chat`. Patrón repetido en `update_lead_stage`, `create_lead`,
`rekey_lead_phone`, `assign_tag`, `remove_tag`: 2 sesiones y 2 conexiones del
pool por mutación.

### 2.6 `GET /api/chats/unread-count` (`db_service.py:1196-1207`)

`SELECT COUNT(DISTINCT chat_id) FROM wsp_messages JOIN leads ...
WHERE sender='cliente' AND (last_read_at IS NULL OR sent_at > last_read_at)`.

Es un **recorrido completo de `wsp_messages`** filtrado por `sender`. No existe
índice que lo soporte (ver sección 3). INFERIDO: con cientos de miles de
mensajes es un seq scan + hash join + agregación distinta en cada llamada. El
frontend lo pide al montar y en cada invalidación (ver sección 7).

### 2.7 `GET /api/chats/kanban/snapshot` (`db_service.py:575-636`)

Una sola consulta para las 13 columnas — buena decisión frente a las 14
peticiones previas. Pero internamente calcula `_chat_columns` (los tres
subqueries correlacionados) **para todos los leads de la base**, más dos window
functions (`COUNT() OVER (PARTITION BY estado)` y `ROW_NUMBER() OVER (...)`)
sobre ese conjunto completo, y recién después filtra `stage_rank <= 40`. Es,
en coste, el peor endpoint del sistema: no hay ninguna forma de que PostgreSQL
evite materializar y ordenar todos los leads.

### 2.8 `GET /api/dashboard/metrics` (`services/dashboard_service.py`)

Seis consultas en paralelo con `asyncio.gather` (líneas 111-118) — es decir,
**seis conexiones del pool simultáneas por request**, porque `_execute_mapping`
abre su propia sesión. Hay caché en memoria de 30 s (líneas 149-162), lo que
salva el caso normal, pero el primer request tras expirar paga todo. Dentro:

- `awaiting_reply` (línea 64) usa un subquery correlacionado por lead
  (`latest_sender`) → un index scan por lead sobre toda la tabla `leads`.
- `avg_response_seconds` (líneas 48-59, 73-77) es un correlacionado sobre
  `wsp_messages` por cada mensaje de cliente del período: `MIN(sent_at)` de
  mensajes de vendedor posteriores. Cuadrático en la práctica sobre el período.
- `trend_stmt` usa `func.date(func.timezone('America/Lima', Lead.created_at))`
  (línea 103) — expresión no indexable, seq scan de `leads` (acotado por
  `created_at >= start`, pero sin índice en `created_at`).

### 2.9 `GET /api/tasks` y `GET /api/templates`

Los dos están bien resueltos y no son cuello de botella:

- `list_tasks` (`services/productivity_service.py:49-68`): una consulta con dos
  JOIN y `LIMIT 500`; el filtro habitual lo cubre
  `idx_lead_tasks_assignee_status_due`. Sin N+1.
- `list_templates` (`services/productivity_service.py:180-215`): dos consultas
  (plantillas + adjuntos con `IN`), sin N+1. El problema no es su coste sino su
  uso: `routers/chats.py:626` la invoca **entera** para localizar una sola
  plantilla al enviarla (ver 7.2e), y el frontend la refetchea con
  `refetchOnWindowFocus` (ver 7.3).

---

## 3. Consultas SQL caras e índices faltantes

### 3.1 Índices que ya existen (verificados en `backend/alembic/versions/`)

- `wsp_messages`: `idx_wsp_messages_chat_cursor (chat_id, sent_at DESC, id DESC)`
  (`eca1f1c0b41a_...:51`), `idx_wsp_messages_wa_message_id` único parcial
  (`a5b229ee1c70_...:80`), `idx_wsp_messages_sent_at (sent_at)`
  (`eca1f1c0b41a_...:376`), `idx_wsp_messages_chat_id` (creado por el flujo n8n,
  `b7a2c9d41e08_...:81` — redundante con el cursor), GIN trigram sobre
  `f_unaccent(content)` (`eca1f1c0b41a_...:416`) y sobre
  `f_unaccent(analysis->>'summary')` (`d4e8f1a2b6c9_...:86`).
- `leads`: `idx_leads_vendedor_id`, GIN trigram sobre `f_unaccent(nombre)`
  (`eca1f1c0b41a_...:420`), y del flujo n8n `idx_leads_estado`,
  `idx_leads_fecha_recontacto`, `idx_leads_proxima_cita`,
  `idx_leads_ultimo_mensaje_at`, `idx_leads_vendedor`.
- Resto de tablas: cobertura razonable (outbox, scheduled, tasks, activity,
  notifications, templates), incluidos los índices de FK añadidos en
  `a5b229ee1c70_...:50-58`.

### 3.2 Índices faltantes concretos

**(a) El más importante — mensajes de cliente por chat.**
Lo piden `_unread_count_subquery`, `_has_unread_messages_condition`,
`_last_customer_message_at_subquery`, `fetch_unread_wa_message_ids`,
`fetch_total_unread_chat_count`, `fetch_latest_customer_message_target` y el
`awaiting_reply` del dashboard. Hoy todos degradan a usar
`idx_wsp_messages_chat_cursor` y filtrar `sender` en el heap, o directamente a
seq scan cuando no hay `chat_id` fijo.

```sql
CREATE INDEX CONCURRENTLY idx_wsp_messages_cliente_chat_sent
    ON wsp_messages (chat_id, sent_at DESC)
    WHERE sender = 'cliente';
```

**(b) Total de no leídos sin `chat_id`.** `fetch_total_unread_chat_count`
agrupa por `chat_id` sobre todos los mensajes de cliente. El índice (a) lo
convierte en un index-only scan del índice parcial en vez de un seq scan de la
tabla completa.

**(c) Búsqueda por teléfono normalizado.** `_identity_conditions`
(`db_service.py:248`, `:252`) usa `regexp_replace(...) LIKE '%digits%'` sin
índice posible por el comodín inicial. Con trigram sí es indexable:

```sql
CREATE INDEX CONCURRENTLY idx_leads_telefono_digits_trgm
    ON leads USING gin (regexp_replace(telefono, '\D', '', 'g') gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_whatsapp_identities_jid_digits_trgm
    ON whatsapp_identities USING gin (regexp_replace(jid, '\D', '', 'g') gin_trgm_ops);
```

**(d) Búsqueda por campos CRM.** `_crm_field_conditions` hace ILIKE con comodín
inicial sobre `servicio_interes` y `origen` sin índice (`db_service.py:262-272`):

```sql
CREATE INDEX CONCURRENTLY idx_leads_servicio_trgm
    ON leads USING gin (f_unaccent(servicio_interes) gin_trgm_ops);
CREATE INDEX CONCURRENTLY idx_leads_origen_trgm
    ON leads USING gin (f_unaccent(origen) gin_trgm_ops);
```

**(e) Teléfono literal.** `Lead.telefono.ilike(pattern)` (`db_service.py:238`)
tampoco tiene índice; `idx_leads_telefono_digits_trgm` no lo cubre porque el
patrón conserva el formato:

```sql
CREATE INDEX CONCURRENTLY idx_leads_telefono_trgm
    ON leads USING gin (telefono gin_trgm_ops);
```

**(f) Tendencia del dashboard.** `Lead.created_at >= start` en dos subqueries
del dashboard, sin índice:

```sql
CREATE INDEX CONCURRENTLY idx_leads_created_at ON leads (created_at DESC);
```

**(g) Kanban por etapa con orden por actividad.** `fetch_kanban_stage` filtra
`estado` y ordena por el LATERAL. `idx_leads_estado` existe (del flujo n8n) pero
no está declarado en `db/models.py`, así que una instalación nueva desde las
migraciones de este repo **no lo tiene**. Conviene declararlo como propio:

```sql
CREATE INDEX CONCURRENTLY idx_leads_estado_updated ON leads (estado, updated_at DESC);
```

**(h) Redundancia a eliminar.** `idx_wsp_messages_chat_id` es prefijo de
`idx_wsp_messages_chat_cursor`: ocupa espacio y encarece cada INSERT de mensaje
sin aportar nada. Pertenece al flujo n8n, así que la retirada hay que
coordinarla, no ejecutarla a ciegas.

### 3.3 El problema que ningún índice arregla

El patrón "LATERAL del último mensaje + ORDER BY sobre esa columna derivada" de
`fetch_chats` / `fetch_kanban_*` no es indexable. La solución real es
**desnormalizar**: mantener en `leads` las columnas `ultimo_mensaje_at`,
`ultimo_emisor` y un contador de no leídos, actualizados por trigger o en el
mismo INSERT del mensaje. Dato relevante: las columnas `ultimo_mensaje_at` y
`ultimo_emisor` **ya existen** en la tabla (las creó el flujo n8n,
`b7a2c9d41e08_...:39-40`) y ya hay índice sobre la primera
(`idx_leads_ultimo_mensaje_at`), pero el CRM no las lee ni las declara en
`db/models.py`. Es la palanca de mayor impacto de todo este informe: convertiría
`fetch_chats` en un index scan de 30 filas sobre `leads (ultimo_mensaje_at DESC)`.

---

## 4. Servicios externos

### 4.0 Contexto de red

`backend/config.py:21-22` documenta que **la base de datos es externa y puede
estar a cientos de milisegundos**. Eso reordena las prioridades: cada sesión
extra, cada round-trip evitable y cada patrón "2 sesiones por mutación" cuesta
directamente latencia de usuario, no solo CPU de PostgreSQL.

Pool: `pool_size=10`, `max_overflow=20` → **30 conexiones máximas**
(`config.py:24-25`), `pool_pre_ping=False` (correcto con RTT alto),
`connect_args={"timeout": 10}` (`db/session.py:31`). Nada configura
`pool_timeout`, así que al agotarse las 30 conexiones un request espera el
default de SQLAlchemy (30 s) antes de fallar.

### 4.1 Comparativa de clientes HTTP

| Servicio | Cliente compartido | Límites de pool | Timeout | Reintentos | Circuit breaker |
|---|---|---|---|---|---|
| Evolution (`evolution_service.py:22-28`) | Sí, módulo-global perezoso | `max_connections=100`, `keepalive=20` | Por llamada: 10 s (`whatsappNumbers`), 20 s (instancia/QR), 30 s (texto, location, template, reaction, markAsRead), 60 s (audio, media, sticker) | Solo en `connect_instance` (3 intentos, QR) | **No** |
| n8n (`n8n_service.py:18-25`) | Sí | `max_connections=20`, `keepalive=10` | 30 s global | **Sí: 3 intentos × 1,5 s de espera** → hasta ~93 s de peor caso | **No** |
| ElevenLabs (`tts_service.py:17-21`) | Sí | Sin `limits` (defaults de httpx: 100/20) | 60 s | No | **No** |
| MinIO (`media_storage.py:134-150`) | Sí, `lru_cache(maxsize=1)` | Pool de urllib3 por defecto (10 conexiones) | **Sin timeout configurado** | Reintentos de urllib3 por defecto | **No** |

Los tres clientes httpx se cierran en el `lifespan` (`main.py:216-218`). La
reutilización del cliente está bien resuelta; no se crea uno por llamada.

### 4.2 Problemas concretos

**(a) n8n: el peor caso es catastrófico en el request del usuario.**
`POST /api/suggestions` (`routers/suggestions.py:32-49`) llama a `call_n8n`
dentro del request. `call_n8n` (`n8n_service.py:66-97`) reintenta hasta 3 veces
con 1,5 s de espera y **timeout de 30 s por intento**. Cota superior:
30+1,5+30+1,5+30 ≈ **93 segundos** con el usuario esperando. Además el reintento
solo cubre respuestas inválidas: un `raise_for_status()` (línea 76) aborta sin
reintentar, y una excepción de red no está capturada por el `try` (que solo
envuelve el parseo), así que sale directamente. Es un comportamiento asimétrico:
reintenta lo que probablemente no se arregla y no reintenta lo transitorio.

**(b) MinIO sin timeout.** `Minio(...)` no recibe `http_client`, así que usa el
`PoolManager` por defecto de urllib3, **sin `timeout`**. Un MinIO colgado (no
caído: colgado) bloquea el hilo del threadpool indefinidamente. Como
`GET /media/{filename}` es un endpoint sync que corre en ese threadpool (default
de anyio: 40 hilos), basta con ~40 descargas colgadas para que **toda la
aplicación deje de servir cualquier endpoint sync**. Es el riesgo de
disponibilidad más serio de esta sección.

**(c) Uso del SDK síncrono de MinIO.** El SDK es bloqueante y se usa
correctamente vía `asyncio.to_thread` en los caminos async
(`routers/chats.py:526,553,594-595`; `message_outbox.py:433,436`;
`db_service.py:1713`; `main.py:292`). No encontré ninguna llamada bloqueante a
MinIO ejecutada directamente en el event loop. Bien resuelto — el coste es de
hilos, no de bloqueo del loop.

**(d) Cadena de dependencias oculta en cada envío.** Cada llamada a Evolution
hace primero `_config()` → `get_effective_many` (caché de 30 s en memoria,
`settings_service.py:100-116`; correcto) y luego
`resolve_whatsapp_destination(chat_id)`
(`whatsapp_identity_service.py:271-295`), que **abre su propia sesión de
PostgreSQL y hace 1-2 consultas**. Es decir: cada mensaje enviado paga un
round-trip a la base remota solo para traducir `lead.id` → JID. Ese mapeo es
prácticamente inmutable y debería estar cacheado en memoria con TTL, igual que
los settings.

**(e) `get_template_capabilities` se llama en el camino de envío interactivo.**
`message_outbox.py:455` la invoca por trabajo; hay caché de 300 s
(`evolution_service.py:111-113,144`), pero en frío es un `GET
/instance/fetchInstances` con timeout 20 s. La caché es un `tuple` global sin
lock: varios trabajos concurrentes en frío disparan varias llamadas.

**(f) Sin circuit breaker en ningún cliente.** Con Evolution caída, cada envío
del outbox espera su timeout completo (hasta 60 s en media), falla, y reintenta
con backoff `2**attempts` (`message_outbox.py:329`) hasta 3 veces. Con
`WORKER_CONCURRENCY=4`, el drenaje de una cola acumulada tras una caída es
lentísimo. Un breaker que corte tras N fallos consecutivos y reintente cada X
segundos evitaría quemar timeouts.

**(g) Qué le pasa al usuario cuando el externo cae** (resumen):

| Endpoint | Externo | Efecto en el usuario |
|---|---|---|
| `POST /api/suggestions` | n8n | Espera hasta ~93 s, luego 502 |
| `POST /api/tts` | ElevenLabs | Espera hasta 60 s, luego 502 |
| `POST /chats/{id}/read` | Evolution | Espera hasta 30 s; el chat se marca leído igual |
| `POST /chats` y `PATCH /chats/{id}` | Evolution | Espera hasta 10 s; fail-open, continúa |
| `POST /chats/{id}/sticker` | MinIO + Evolution | Espera hasta 60 s (+ MinIO sin timeout), luego 502 |
| `POST .../reaction` | Evolution | Espera hasta 30 s, luego 502 |
| `GET /chats/{id}/history` | Evolution | Espera hasta 30 s, luego 502 |
| `GET /media/{f}` | MinIO | **Cuelga sin límite**; agota el threadpool |
| `POST /chats/{id}/messages` | — | No afectado (outbox). Correcto |

---

## 5. Media: subida, descarga, streaming y cacheo

### 5.1 Subida

- Camino del vendedor: `POST /api/chats/{id}/{audio,media}` recibe el archivo
  como **base64 dentro de un JSON** (`SendMediaRequest.data_base64`). Sobrecoste
  de transferencia ~33 %, y el cuerpo completo se materializa en memoria del
  proceso: hasta 25 MB por request en el buffer de Starlette, más la copia
  decodificada, más la copia base64 que se vuelve a generar al enviar a Evolution
  (`read_media_base64`, `media_storage.py:271-273`). ESTIMACIÓN: pico de ~90 MB
  de RSS por subida de 25 MB. Con varias subidas simultáneas es riesgo de OOM.
  Un `multipart/form-data` con streaming a MinIO eliminaría las tres copias.
- La compresión de vídeo con `ffmpeg` (`media_storage.py:280-332`) tiene timeout
  de **300 s** y corre en el threadpool. Ocupa un hilo del executor y, con varias
  subidas de vídeo a la vez, compite con las descargas de `/media`.
- `save_media_bytes` calcula `sha256` del contenido completo antes del
  `put_object` (`media_storage.py:480`): otra pasada completa sobre los bytes.

### 5.2 Descarga

`GET /media/{filename}` (`routers/media.py:161-190`) es un **proxy por el
backend**, no una URL prefirmada. Implicaciones:

- Todo el ancho de banda de medios pasa por el proceso Python. Un vendedor
  abriendo un chat con 20 imágenes genera 20 requests que atraviesan el
  threadpool y el buffer del backend.
- El streaming en sí está bien hecho: `iter_media_stat` reutiliza el `stat` en
  vez de repetirlo (`media_storage.py:242-257`), hay soporte de `Range`
  (`_requested_range`, `routers/media.py:136-158`) y chunks de 64 KB. Es
  streaming real, no carga en memoria. Bien.
- `_minio_stat` prueba **hasta 4 claves candidatas** por objeto
  (`media_storage.py:102-121, 171-189`) para tolerar URLs históricas sin
  extensión. En el peor caso son 4 round-trips a MinIO **antes** de empezar a
  servir el primer byte. Debería resolverse persistiendo la clave real en
  `wsp_messages`/`media_assets` en vez de adivinarla en cada lectura.

### 5.3 Cacheo

`Cache-Control: private, max-age=3600` y nada más (`routers/media.py:176`):

- **No hay `ETag` ni `Last-Modified`**, así que pasada la hora el navegador
  no puede revalidar con un 304: vuelve a descargar el archivo entero.
- Los nombres son UUID (`routers/media.py:132`), es decir **contenido inmutable**.
  El valor correcto es `max-age=31536000, immutable`. Cambio de una línea con
  impacto directo y grande en el tráfico de medios.
- No hay CDN ni presigned URLs. Para MinIO, `presigned_get_object` con una
  expiración de minutos sacaría el tráfico del backend por completo; el
  inconveniente es que la URL deja de estar protegida por la cookie de sesión
  durante su vigencia, lo que hay que decidir explícitamente.

### 5.4 Dimensiones perezosas

`_fill_media_dimensions` (`db_service.py:1689-1737`) es un backfill perezoso que
solo corre la primera vez por mensaje, con concurrencia 6 y lectura de cabecera
por rango (128 KB para imágenes, solo el box `moov` para vídeos). Es un diseño
cuidado. El defecto es *dónde* corre: dentro del request de apertura del chat y
con la sesión de base abierta. Debería ser un trabajo de fondo disparado al
insertar el mensaje.

---

## 6. WebSockets: fan-out y latencia percibida

`ConnectionManager.broadcast` (`services/ws_manager.py:20-43`) manda a **todas**
las conexiones, sin filtrar por usuario ni por chat. Coste de fan-out por evento:
`O(conexiones)`, con `asyncio.gather` y `wait_for(timeout=2.0)` por socket.

El coste de red del broadcast es despreciable (payloads de decenas de bytes). El
problema **no es el fan-out sino lo que provoca en cada cliente**: cada
`chats_updated` hace que todos los navegadores conectados invaliden `['chats']`
y `['unread-count']` (`useChats.ts:456-457`), es decir que **cada mensaje de
cualquier chat dispara la consulta más cara del sistema en todos los clientes a
la vez**.

Cuantificación (ESTIMACIÓN, razonamiento explícito): con V vendedores conectados
y M mensajes por minuto en toda la instancia, el backend recibe
`V × M` ejecuciones de `fetch_chats` por minuto, más `V × M` de `unread-count`.
Con 8 vendedores y 60 mensajes/minuto en hora punta son ~480 ejecuciones por
minuto de una consulta que recorre todos los leads, más otras 480 del
`COUNT(DISTINCT)` sin índice. Ese es el mecanismo por el que la latencia se
degrada justo cuando hay actividad — exactamente al revés de lo que se necesita.

Detalles menores:

- `broadcast` retiene `self._lock` solo para copiar la lista (bien), pero el
  `gather` es sin límite de concurrencia. Con muchas conexiones lentas, hasta
  2 s de tareas pendientes por evento.
- Emisores del broadcast global que podrían ser dirigidos: `tasks_updated`
  (`routers/tasks.py:42,62`) va a todos aunque la tarea sea de un solo
  vendedor; `chats_updated/reason=read` (`routers/chats.py:790`) avisa a todos
  de que *otro* leyó un chat.
- El estado vive en un `dict` de proceso: con más de una réplica, un broadcast
  solo alcanza a los clientes de esa réplica. Ya señalado en el análisis previo;
  aquí solo se anota que la mitigación existente es el `refetchInterval` de
  respaldo, que es tráfico adicional.

---

## 7. Frontend: cascadas, refetch y payloads

### 7.1 Cascada al abrir una conversación

`App.tsx:184` resuelve `useChat(chatId)` → `GET /api/chats/{id}`, y **hasta que
no responde no se monta `ChatThread`**, que es quien dispara el resto. Eso
introduce un round-trip completo de espera antes de que empiece a cargar el
historial, cuando el chat **ya está en la caché del listado**
(`['chats','list',...]`). Con `initialData` o `placeholderData` tomados de esa
caché, la cascada desaparecería.

Peticiones que se disparan al abrir un chat (INFERIDO de `App.tsx` y
`ChatThread.tsx:96-152`):

1. `GET /api/chats/{id}` (bloqueante para el resto)
2. `GET /api/chats/{id}/messages`
3. `GET /api/chats/{id}/service-window`
4. `GET /api/chats/{id}/activity`
5. `GET /api/leads/{id}/notes`
6. `GET /api/chats/history/availability`
7. `GET /api/suggestions/{id}`
8. `POST /api/chats/{id}/read` (que además llama a Evolution, ver 2.4)
9. `GET /api/templates` y `GET /api/scheduled-messages/{id}` al montar el
   composer

Ocho o nueve peticiones, en dos oleadas por la cascada del punto 1. Y el `POST
/read` invalida `['chats']` y `['unread-count']` localmente
(`useChats.ts:652-655`) **y además** provoca un broadcast que las invalida en
todos los demás clientes.

### 7.2 Refetch excesivo

**(a) Polling de mensajes cada 5 segundos.** `useMessages`
(`useMessages.ts:48`) tiene `refetchInterval: 5_000` **además** del WebSocket.
Con la pestaña visible y un chat abierto son 12 peticiones por minuto por
vendedor, permanentes.

**(b) Multiplicado por el número de páginas.** `useMessages` y
`useInfiniteChats` son `useInfiniteQuery` y **no configuran `maxPages`**
(verificado: no hay ninguna ocurrencia de `maxPages` en `frontend/src`). En
TanStack Query v5, refetchear una infinite query **refetchea todas las páginas
cargadas, secuencialmente**. Consecuencias:

- Un vendedor que scrolleó 6 páginas de historial genera **6 peticiones cada 5
  segundos** para ese chat.
- Cada invalidación de `['chats']` refetchea todas las páginas del listado que
  se hayan cargado por scroll infinito — y cada una es la consulta cara de 2.1.

Este punto y el fan-out del WebSocket se multiplican entre sí. Es, con
diferencia, el mayor amplificador de carga del sistema.

**(c) `resync()` al reconectar** (`useChats.ts:334-338`) invalida 7 familias de
queries de golpe: `chats`, `unread-count`, `kanban`, `dashboard`,
`notifications`, `messages`, `chat`. Correcto en intención, pero como el
watchdog fuerza reconexión ante 40 s sin actividad
(`useChats.ts:107,354-356`), una red inestable produce ráfagas de resync
completo. Cada resync incluye el snapshot de Kanban (2.7).

**(d) Búsqueda de duplicados.** `useDuplicateLead` (`useChats.ts:599-609`)
llama a `GET /api/chats?search=<digits>` con `staleTime: 15_000` mientras el
usuario escribe un teléfono. Cada valor distinto de `digits` es una queryKey
nueva → una ejecución completa de la búsqueda cara (con el `regexp_replace` sin
índice de 3.2c) por cada dígito tecleado a partir del octavo.

**(e) `send_template` carga el catálogo entero.** `routers/chats.py:626` hace
`next(item for item in await list_templates(user.id) if item["id"] == template_id)`:
trae **todas** las plantillas con **todos** sus adjuntos para quedarse con una.
Debería ser un `get_template(template_id, user_id)`.

### 7.3 Payloads

- `GET /api/chats` devuelve por cada chat `notas` completas y el objeto de
  etiquetas; con `search` añade `matched_message` sin truncar. Nada acotado.
- `GET /api/chats/{id}/messages` con `until_id` puede devolver cientos de
  mensajes con sus JSONB `analysis`, `payload` y `reactions` completos (2.2).
- `GET /api/templates` devuelve `interactive_config` completo de cada plantilla
  y se refetchea con `refetchOnWindowFocus: true` (`useTemplates.ts:36`).
- `GET /api/chats/kanban/snapshot` devuelve 13 × 40 = hasta 520 objetos `Chat`
  completos en una sola respuesta.

### 7.4 Ajustes de caché

Los `staleTime` están razonablemente puestos (30 s chats, 15 s mensajes, 60 s
plantillas/sugerencias, `Infinity` en `phone-config` e historial de Evolution).
No hay ningún `gcTime` configurado fuera de los tests y de
`useEvolutionHistory.ts:34`; con el default de 5 minutos, cambiar de chat y
volver fuerza recarga completa del historial. Subir `gcTime` a 30 minutos en
`['messages']` y `['chat']` haría que volver a un chat reciente fuese
instantáneo. **No hay prefetch en ningún punto**: ni al pasar el ratón sobre un
chat de la lista, ni de la siguiente página.

---

## 8. Propuestas priorizadas

Impacto: efecto estimado sobre la latencia p95 del camino crítico.
Esfuerzo: L (horas), M (1-3 días), G (más de 3 días).
Todas las estimaciones son ESTIMACIONES razonadas, no mediciones.

| # | Propuesta | Dónde | Impacto | Esfuerzo |
|---|---|---|---|---|
| 1 | Desnormalizar `leads.ultimo_mensaje_at` / `ultimo_emisor` / `unread_count` y reescribir `fetch_chats`, `fetch_kanban_*` y `fetch_chat` para leerlos en vez del LATERAL + subqueries correlacionados. Las dos primeras columnas y su índice **ya existen** en la base | `db_service.py:137-189, 349-375, 399-500, 575-678` | Muy alto: convierte la consulta más cara en un index scan de 30 filas. ESTIMACIÓN: de cientos de ms/segundos a decenas de ms | G |
| 2 | Fijar `maxPages` en las infinite queries (p. ej. 3) y subir `refetchInterval` de mensajes de 5 s a 20-30 s (o eliminarlo, ya hay WebSocket) | `useMessages.ts:32-51`, `useChats.ts:567-583` | Muy alto: divide entre 4-10 el número de peticiones al camino crítico | L |
| 3 | Añadir el índice parcial `idx_wsp_messages_cliente_chat_sent` (3.2a) | migración nueva | Alto: arregla no leídos, ventana de servicio y `awaiting_reply` del dashboard | L |
| 4 | `Cache-Control: max-age=31536000, immutable` + `ETag` en `/media/{filename}` | `routers/media.py:173-178` | Alto sobre el tráfico y la latencia percibida al reabrir chats | L |
| 5 | Poner `timeout` explícito al cliente MinIO (`http_client=urllib3.PoolManager(timeout=...)`) | `media_storage.py:143-150` | Alto en disponibilidad: evita agotar el threadpool | L |
| 6 | Sacar del request las llamadas a Evolution de `POST /chats/{id}/read` (a tarea de fondo) | `routers/chats.py:768-791` | Alto: quita hasta 30 s del camino de apertura de chat | M |
| 7 | Acotar `call_n8n`: 1 reintento, timeout total con presupuesto (p. ej. 25 s) y capturar errores de red | `n8n_service.py:66-97` | Alto en el peor caso: de ~93 s a ~25 s | L |
| 8 | Alimentar `useChat` con `initialData` desde la caché del listado para eliminar la cascada de apertura | `useChats.ts:543-552`, `App.tsx:184` | Medio-alto: quita un RTT completo antes de cargar el hilo | L |
| 9 | Cachear en memoria (TTL) el mapeo `lead.id → JID` de `resolve_whatsapp_destination` | `whatsapp_identity_service.py:271-295` | Medio: quita 1-2 round-trips a la base remota por mensaje enviado | L |
| 10 | Índices de búsqueda faltantes (3.2c, d, e) | migración nueva | Medio: la búsqueda deja de ser seq scan de `leads` | L |
| 11 | Reutilizar una sola sesión en las mutaciones en vez de abrir otra para `fetch_chat` | `db_service.py:705-776, 908-952, 955-…` | Medio con base remota: ahorra un checkout y un RTT por mutación | M |
| 12 | Dirigir los broadcasts: `tasks_updated` a los interesados, `read` solo al emisor | `ws_manager.py:45-54`, routers | Medio: reduce el efecto multiplicador del fan-out | M |
| 13 | Mover `_fill_media_dimensions` a trabajo de fondo (al insertar el mensaje) | `db_service.py:1689-1737` | Medio: quita RTT a MinIO del GET de historial y suelta la conexión antes | M |
| 14 | Reemplazar el base64 de subida por `multipart/form-data` con streaming | `routers/chats.py:520-580`, `models/schemas.py` | Medio: −33 % de bytes y −2 copias en memoria | G |
| 15 | `get_template(template_id, user_id)` en vez de `list_templates()` completo al enviar plantilla | `routers/chats.py:626` | Bajo-medio | L |
| 16 | Persistir la clave real del objeto MinIO para evitar hasta 4 `stat_object` por descarga | `media_storage.py:102-121` | Bajo-medio | M |
| 17 | Circuit breaker compartido para Evolution/n8n/ElevenLabs | servicios externos | Bajo en régimen normal, alto durante incidentes | M |
| 18 | Subir `gcTime` a ~30 min en `['messages']` y `['chat']`; prefetch al hover en `ChatList` | hooks del frontend | Bajo-medio, muy visible en la percepción | L |
| 19 | `pool_timeout` explícito y menor (p. ej. 5 s) para fallar rápido en vez de colgar 30 s | `db/session.py:29-36` | Bajo en régimen normal | L |
| 20 | Retirar `idx_wsp_messages_chat_id` (redundante), coordinado con el flujo n8n | migración nueva | Bajo: abarata los INSERT de mensajes | L |

Orden de ejecución recomendado: **2, 4, 5, 3, 7** (todas de esfuerzo L y alto
impacto, sin tocar el modelo de datos) → **8, 9, 6** → **1** (el cambio grande,
ya con medición previa para demostrar la mejora).

---

## 9. Plan de medición

### 9.1 Qué existe hoy

`services/performance.py` mide, por request y mediante `ContextVar`:

- `query_count`: número de ejecuciones de cursor (listener `after_cursor_execute`
  sobre el engine, `performance.py:66-74`).
- `database_ms`: suma del tiempo de esas ejecuciones.
- `external_ms`: acumulado por nombre de externo, alimentado manualmente con
  `record_external_duration` desde `evolution_service`, `n8n_service` y
  `tts_service`.

`main.py:225-246` los expone como cabeceras `Server-Timing` y `X-DB-Queries`, y
loguea "Slow request" por encima de 1000 ms.

Limitaciones reales de esta instrumentación:

1. **No mide MinIO.** Ninguna llamada a `media_storage` invoca
   `record_external_duration`. El tiempo de MinIO aparece indistinguible del
   tiempo de aplicación.
2. **No agrega nada.** No hay percentiles, ni histogramas, ni serie temporal.
   Solo cabeceras por request y una línea de log cuando ya es tarde.
3. **El umbral de 1000 ms es demasiado alto** para diagnosticar: un endpoint que
   sistemáticamente tarda 700 ms nunca aparece en el log.
4. **La ruta se loguea sin plantilla**: `request.url.path` incluye el `chat_id`,
   así que agrupar por endpoint es imposible sin normalizar. Hay que usar
   `request.scope["route"].path` (`/api/chats/{chat_id}/messages`).
5. **El `ContextVar` no cruza `asyncio.to_thread`** con propagación de tiempo:
   las mediciones de trabajos de fondo (outbox, watchers) no se registran en
   ningún sitio porque no hay request que las enmarque.

### 9.2 Implementación mínima recomendada

**(a) Percentiles por endpoint, en proceso, sin dependencias nuevas.**
Ampliar `performance.py` con un registro `dict[(method, route_template), lista
acotada de duraciones]` y exponer `GET /health/metrics` (admin) que devuelva
p50/p95/p99, media y conteo por endpoint desde el arranque. Es ~60 líneas y no
requiere Prometheus. Suficiente para responder "¿cuánto tarda realmente
`GET /api/chats`?", que hoy nadie sabe.

**(b) Si se acepta una dependencia**: `prometheus-fastapi-instrumentator`. Da
histogramas por ruta y método listos, y `/metrics`. Es la opción correcta si ya
hay Prometheus/Grafana en el despliegue.

**(c) Instrumentar MinIO.** Envolver `stat_media`, `iter_media_stat` y
`save_media_bytes` con `record_external_duration("minio", ...)`. Sin esto, la
sección 5 sigue siendo inverificable.

**(d) Bajar el umbral de "Slow request" a 300 ms** y normalizar la ruta:

```python
route = request.scope.get("route")
path = getattr(route, "path", request.url.path)
```

**(e) Log de consultas lentas en PostgreSQL.** Lo que hay que activar en el
servidor:

```sql
ALTER SYSTEM SET log_min_duration_statement = '200ms';
ALTER SYSTEM SET log_lock_waits = on;
ALTER SYSTEM SET log_temp_files = 0;
SELECT pg_reload_conf();

CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
-- requiere shared_preload_libraries = 'pg_stat_statements' y reinicio
```

Consulta de diagnóstico una vez activo:

```sql
SELECT calls,
       round(mean_exec_time::numeric, 1) AS media_ms,
       round(total_exec_time::numeric)   AS total_ms,
       rows / GREATEST(calls, 1)         AS filas_por_llamada,
       left(query, 120)                  AS consulta
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 25;
```

**(f) `EXPLAIN (ANALYZE, BUFFERS)` de los cuatro sospechosos**, que es lo que
convierte este informe en datos: `fetch_chats` sin filtros, `fetch_chats` con
`search`, `fetch_kanban_snapshot` y `fetch_total_unread_chat_count`. En
particular hay que **confirmar empíricamente** la hipótesis de la sección 2.1
(que los subqueries correlacionados de la lista de columnas se evalúan para
todos los leads y no solo para los 30 devueltos): el plan lo dirá sin ambigüedad
y es la premisa de la propuesta número 1.

**(g) Monitorizar el pool.** Exponer en `/health/metrics`
`engine.pool.checkedout()`, `.size()` y `.overflow()`. Con 30 conexiones
máximas, el dashboard consumiendo 6 a la vez y `fetch_messages` reteniendo la
suya durante descargas de MinIO, saber cuánto se acerca el pool a su techo es lo
que permite anticipar el incidente en vez de diagnosticarlo después.

**(h) Métricas del cliente.** Registrar `Server-Timing` desde el frontend
(`PerformanceObserver` sobre entradas `resource`) daría la latencia real vista
por el vendedor, incluida la red, que es la que importa. Opcional, pero es el
único punto donde se mide lo que el usuario percibe.

### 9.3 Orden sugerido

1. (d) + (a): visibilidad inmediata, sin dependencias, una tarde de trabajo.
2. (e): activar `log_min_duration_statement` y `pg_stat_statements`. Dejar
   correr una semana de tráfico real.
3. (f): `EXPLAIN ANALYZE` de las cuatro consultas con datos de producción.
4. Recién entonces decidir si la propuesta 1 (desnormalización) se ejecuta como
   está descrita o si los planes reales apuntan a otra cosa.
