# Plan: ingesta de eventos de Evolution API por RabbitMQ

Rama: `feat/eventos-rabbitmq`

> **No es lo que se está construyendo hoy.** Lo implementado es
> [rabbitmq-ingesta-n8n-plan.md](rabbitmq-ingesta-n8n-plan.md): la cola se pone
> delante de n8n, que sigue siendo quien normaliza y persiste. Este documento
> describe el paso siguiente —mover la persistencia al backend— y sigue vigente
> como destino. El exchange que ya quedó montado es `topic`, así que empezar la
> fase 3 (modo sombra) es agregar `q.crm.inbound` con otro binding.
>
> Antes de retomarlo, leer las correcciones de la sección "Errores conocidos de
> este documento", al final.

## Por qué

Hoy la única ruta por la que un mensaje de WhatsApp llega a la base es:

```text
Evolution API --webhook HTTP--> n8n --INSERT--> PostgreSQL
                                  \--HTTP--> backend /api/webhooks/* --> broadcast WS
```

Tres consecuencias que este plan viene a corregir:

1. **n8n decide si un mensaje existe.** Si un workflow está en modo test, si
   alguien lo desactiva o si la VPS de n8n se cae, no hay mensaje en el CRM y
   nadie se entera hasta que un vendedor lo reporta.
2. **Los fallos son invisibles y definitivos.** El patrón actual en
   `routers/webhooks.py` es `except Exception: logger.exception(...)`. El evento
   se perdió y sólo queda una línea de log. No hay reintento ni forma de
   reprocesar.
3. **El backend no puede correr con más de una réplica.** `services/ws_manager.py`
   guarda las conexiones en un `dict` del proceso y `services/message_outbox.py`
   se despierta con un `asyncio.Event` in-process (su propio comentario lo
   documenta). Con dos réplicas, la mitad de los paneles no recibe eventos.

Efecto secundario, no el objetivo principal: durante el swap blue-green los
eventos dejan de perderse porque se acumulan en la cola.

## Arquitectura destino

```text
Evolution API ──publish──> exchange evolution_exchange (topic)
                             │
                             ├──> q.crm.inbound   ──> worker del backend ──> PostgreSQL
                             │                              │
                             │                              └──> exchange app_events (fanout)
                             │                                        │
                             ├──> q.n8n.ia        ──> n8n (sólo IA)   ├──> réplica API 1 ──> WS
                             │         │                              └──> réplica API 2 ──> WS
                             │         └──HTTP──> /api/webhooks/analysis
                             │                    /api/webhooks/lead-stage
                             │
                             └──> q.archive.raw   ──> payloads crudos (auditoría y replay)
```

Dos exchanges, con responsabilidades separadas:

- **`evolution_exchange`**: lo que entra desde WhatsApp. Lo crea Evolution.
- **`app_events`**: eventos internos de la aplicación (los que hoy pasan por
  `manager.broadcast`). Lo crea el backend.

## Decisiones de diseño

### Dónde vive RabbitMQ

En su propio archivo `compose.mq.yml` y su propio proyecto de compose, colgado
de la red `dermicapro-data`. El mismo razonamiento que ya está escrito en la
cabecera de `compose.db.yml`: si el broker viviera dentro de `compose.prod.yml`,
cada color blue-green levantaría **su propio** RabbitMQ vacío y los mensajes
encolados por uno serían invisibles para el otro. Además, un `down` de la
aplicación no puede llevarse por delante una cola con eventos sin procesar.

Volumen con nombre explícito (`dermicapro-rabbitmq`) para que las colas durables
sobrevivan a un recreate del contenedor.

### Exposición de red

RabbitMQ **no publica ningún puerto al host**. n8n corre en otra VPS y Evolution
también, así que ambos llegan por el túnel WireGuard descrito en
`docs/red-privada-wireguard.md`:

| Máquina | IP en el túnel |
|---|---|
| App + PostgreSQL + RabbitMQ | `10.8.0.1` |
| n8n | `10.8.0.2` |
| Evolution API | pendiente de confirmar; si está en una tercera VPS hay que añadirla como peer (`10.8.0.3`) |

Bind idéntico al de PostgreSQL: `${RABBITMQ_BIND_IP:-127.0.0.1}:5672:5672`, con
`RABBITMQ_BIND_IP=10.8.0.1` en producción. Publicar 5672 en `0.0.0.0` es
exactamente el error que abrió la auditoría de la base anterior.

La consola de administración (15672) sólo por túnel SSH, nunca vía Traefik.

### Tres usuarios, no uno

| Usuario | Permisos | Para |
|---|---|---|
| `evolution` | sólo `configure`/`write` sobre `evolution_exchange` | publicar |
| `crm` | `read` sobre sus colas, `write` sobre `app_events` | worker y API |
| `n8n` | `read` sobre `q.n8n.ia` | análisis IA |

Se borra el `guest` por defecto. Si mañana se filtra la credencial de n8n, no
alcanza para leer la cola de ingesta ni para publicar eventos falsos al CRM.

### Dónde corre el worker

Como un servicio más **dentro del proyecto de color** (`compose.prod.yml`),
misma imagen que el backend y distinto `command`.

Durante el solape blue-green los dos colores consumen la misma cola a la vez.
Eso no duplica trabajo: una cola entrega cada mensaje a **un solo** consumidor,
así que el solape se comporta como balanceo de carga y la ingesta nunca queda
sin consumidor. Es más simple que un proyecto aparte y da continuidad gratis.

La única ventana rara es que, durante esos segundos, código viejo y nuevo
consumen a la vez. Con handlers idempotentes es irrelevante.

### Qué se queda en n8n

n8n deja de ser quien persiste, pero **conserva todo lo que hace bien**:

- Análisis IA de adjuntos (transcripción de audio, descripción de imagen y
  vídeo con Gemini).
- El agente analista que deduce nombre, teléfono, servicio de interés y etapa
  del lead.

Ambos siguen entrando por los webhooks HTTP que ya existen
(`/api/webhooks/analysis`, `/api/webhooks/lead-stage`).

Esto además **mejora la latencia percibida**: hoy un audio no aparece en el chat
hasta que Gemini termina de transcribirlo, porque el INSERT está después del
nodo de análisis. Con este diseño el mensaje se guarda y se pinta al instante, y
la transcripción se fusiona segundos después sobre la misma fila.

### Idempotencia

RabbitMQ reentrega ante un `nack` o una desconexión sin `ack`. La base ya tiene
la pieza clave: el índice único parcial `idx_wsp_messages_wa_message_id`
(`db/models.py:235`) y la lógica de deduplicación que cubre
`tests/test_insert_message_dedup.py`.

Regla para todo handler nuevo: la clave de deduplicación es `key.id` de
Evolution (el `wa_message_id`), y reprocesar el mismo evento dos veces debe ser
un no-op observable, no un error.

### Orden de los mensajes

Con `prefetch > 1` o varios consumidores, dos mensajes del mismo chat pueden
procesarse en paralelo y persistirse fuera de orden. Visualmente no importa (el
hilo se ordena por `sent_at`), pero las automatizaciones sí podrían dispararse
en orden incorrecto.

Decisión: empezar con `prefetch=1` por consumidor. Al volumen actual sobra, y
evita el problema entero. Si hiciera falta escalar, la salida es una routing key
por `chat_id` con un exchange de hash consistente, no subir el prefetch a ciegas.

---

## Fases

Cada fase es mergeable por separado y deja el sistema funcionando.

### Fase 0 — Infraestructura, sin tocar el flujo actual

**Entregables**

- `compose.mq.yml` con el servicio `rabbitmq` (imagen `rabbitmq:4-management-alpine`,
  fijada por versión mayor por el mismo motivo que PostgreSQL).
- `db/../mq/definitions.json` o script de provisión con vhost, los tres usuarios
  y sus permisos.
- Sección nueva en `docs/red-privada-wireguard.md` si Evolution entra al túnel.
- `docs/` actualizado con el comando de arranque.

**Listo cuando**: el broker levanta, la consola responde por túnel SSH, y desde
el contenedor del backend `nc -z rabbitmq 5672` responde.

### Fase 1 — Extraer la lógica de los handlers HTTP

Es el paso que hace posible todo lo demás: hoy la lógica de negocio vive
**dentro** de los endpoints de `routers/webhooks.py`, así que un consumidor AMQP
no puede reutilizarla sin hacerse peticiones HTTP a sí mismo.

**Entregables**

- Nuevo `backend/services/inbound_events.py` con las funciones de dominio:
  `handle_inbound_message`, `handle_reaction`, `handle_message_edited`,
  `handle_message_deleted`, `handle_message_status`, `handle_outgoing`,
  `handle_lead_stage`.
- `routers/webhooks.py` queda como capa fina: parsea el body, delega, traduce el
  resultado a respuesta HTTP. Los `HTTPException` se quedan en el router; los
  servicios devuelven resultados o lanzan excepciones de dominio.
- Tests de servicio nuevos, en paralelo a los de ruta que ya existen
  (`test_message_status_webhook.py`, `test_reaction_webhook.py`,
  `test_outgoing_webhook.py`, `test_lead_stage_webhook.py`...).

**Listo cuando**: la suite entera pasa sin cambios en los tests de ruta
existentes. Cambio de estructura puro, cero cambio de comportamiento.

### Fase 2 — Normalizador de payloads de Evolution en Python

Hoy la traducción de `messageType` de WhatsApp a las columnas
`content` / `message_type` / `analysis` / `payload` vive en los nodos `* content*`
de n8n (está documentada en `docs/n8n-normalizacion-wsp-messages.md`). Para
consumir desde la cola hay que tenerla en el backend.

**Entregables**

- `backend/services/evolution_events.py`: `parse_messages_upsert(payload)` que
  devuelve un objeto de dominio, cubriendo la taxonomía completa que ya está en
  la tabla de ese doc — text, image, video, audio, sticker, document, location,
  contact, poll, reaction, template, interactive/buttonsResponse.
- Fixtures con payloads **reales**, no inventados. Para conseguirlos, adelantar
  la cola `q.archive.raw` de la fase 5 y dejarla capturando unos días antes de
  escribir el parser.
- Reutilizar lo que ya existe en vez de reimplementarlo: `parse_evolution_identity`
  y `resolve_whatsapp_identity` (`services/whatsapp_identity_service.py`) ya
  resuelven LID contra teléfono, y `parse_message_status_events`
  (`services/message_status_service.py`) ya normaliza `MESSAGES_UPDATE`.

**Listo cuando**: para cada payload de la carpeta de fixtures, el parser produce
exactamente las mismas columnas que produjo n8n en la fila real de la base.

### Fase 3 — Worker consumidor, en modo sombra

**Entregables**

- Dependencia `aio-pika` en `backend/requirements.txt`.
- `backend/services/mq/connection.py`: conexión robusta con reconexión
  automática y `channel.set_qos(prefetch_count=1)`.
- `backend/services/mq/consumer.py`: bucle de consumo, mapa evento → handler de
  la fase 1, `ack` / `nack` explícitos.
- `backend/worker.py` con entrypoint `python -m worker`, que replica del
  `lifespan` de `main.py` la espera de base y `_verify_schema_is_current()`: un
  worker consumiendo contra un esquema viejo corrompe datos en silencio.
- Servicio `worker` en `compose.prod.yml`.
- Config nueva en `config.py`: `rabbitmq_url`, `rabbitmq_exchange`,
  `mq_consumer_mode` (`off` | `shadow` | `active`), `mq_prefetch`,
  `mq_max_attempts`.

**Modo sombra**: el worker consume, normaliza y **no escribe** en las tablas de
producción. Registra en una tabla `mq_shadow_log` qué habría insertado, y un
script compara contra lo que n8n insertó de verdad.

**Listo cuando**: tras varios días de tráfico real la divergencia es cero — mismo
número de mensajes, mismas columnas, mismos `chat_id` resueltos. Toda diferencia
es un bug del parser que había que encontrar aquí y no en producción.

### Fase 4 — El corte

**Backend**: `MQ_CONSUMER_MODE=active`. El worker pasa a persistir y a publicar
en `app_events`.

**n8n**: ver la sección "Plan de n8n" más abajo.

**Convivencia**: Evolution admite webhook y RabbitMQ **a la vez**. El webhook
hacia n8n se deja configurado unas semanas; sólo cambian los nodos de n8n. El
rollback es volver a `off` y reactivar los nodos de INSERT.

**Listo cuando**: 72 h sin divergencia con el worker activo y n8n sin escribir.

### Fase 5 — DLQ, reproceso y observabilidad

**Entregables**

- `q.crm.inbound` declarada con `x-dead-letter-exchange: dlx` y su
  `q.crm.inbound.dlq`. Tras `mq_max_attempts` (contados por el header `x-death`),
  el evento va a la DLQ en vez de reintentar para siempre.
- `q.archive.raw`: cola durable con TTL largo bindeada a `#`, que guarda el
  payload crudo. Es lo que permite reprocesar historia cuando se arregla un bug
  del parser.
- `scripts/mq-replay.py`: reinyecta de la DLQ o del archivo a la cola principal.
- `/health/ready` incorpora el estado del broker; y una métrica de profundidad
  de cola y edad del último evento consumido, que es la señal temprana de que el
  worker se atascó.

**Listo cuando**: se puede provocar un fallo a propósito, verlo aparecer en la
DLQ, arreglarlo y reprocesarlo sin pérdida.

### Fase 6 — Fanout interno: desbloquear las réplicas

**Entregables**

- Exchange `app_events` (fanout). `ConnectionManager.broadcast` pasa a publicar
  ahí en vez de escribir directo a los sockets.
- Cada proceso de API declara al arrancar una cola **exclusiva y auto-delete**
  bindeada a `app_events`, y lo que recibe lo reenvía a sus WebSockets locales.
- Degradación: si el broker no está disponible, `broadcast` cae al
  comportamiento actual (entrega local). Así el entorno de desarrollo sigue
  funcionando sin RabbitMQ levantado.
- Mismo mecanismo para `message_outbox.notify_new_work()`, que hoy sólo despierta
  al worker de su propio proceso.

**Listo cuando**: con dos réplicas de backend levantadas, un mensaje entrante
aparece en un panel conectado a cada una de las dos.

### Fase 7 — Opcional, después: WebSocket de Evolution para el QR

No para ingerir mensajes (sin durabilidad, un reconnect deja un hueco), sino
para el alta de tenant del plan multi-tenant: `QRCODE_UPDATED` y
`CONNECTION_UPDATE` en vivo, sin que el frontend pollee `/instance/connectionState`.

El socket lo abre el **backend** (la apikey de Evolution no puede llegar al
navegador) y reenvía por el WS que ya existe con `manager.send_to_user`.

---

## Plan de n8n

### Estado actual

El workflow **rag** (`rag.json` en la raíz, sin versionar por contener
credenciales) hace hoy, en un solo flujo:

```text
Webhook Evolution
  -> filtros (messages.upsert, fromMe=false, chat individual)
  -> Resolver identidad WhatsApp (HTTP al backend)
  -> Switch por messageType -> nodos "* content*" (normalización)
  -> nodos de análisis IA (Analyze an image / audio / video)
  -> guardar mensajes en posgress1   <-- INSERT directo
  -> HTTP a /api/webhooks/messages
  -> agente analista -> UPDATE leads + /api/webhooks/lead-stage
```

### Estado destino

Se parte en **dos workflows** con responsabilidades separadas.

**Workflow A — "IA de adjuntos"**

- Trigger: **RabbitMQ Trigger** sobre `q.n8n.ia`, en lugar del Webhook.
- Filtra a los tipos con adjunto (`audioMessage`, `imageMessage`, `videoMessage`,
  `documentMessage`).
- Corre el análisis que ya corre hoy (los mismos nodos de Gemini).
- Termina llamando a `POST /api/webhooks/analysis` con `wa_message_id`,
  `chat_id` y el bloque `analysis`.

Requiere extender `/api/webhooks/analysis`: hoy está pensado para media
**saliente** (`attach_outgoing_analysis`). Hay que admitir también la entrante,
fusionando por `wa_message_id` sobre la fila que ya insertó el worker. Va en la
fase 1, junto al resto de la extracción.

**Workflow B — "Analista de leads"**

- Trigger: RabbitMQ sobre la misma cola, o el que ya tiene por tiempo/mensaje.
- Sin cambios en la lógica del agente.
- Sigue llamando a `POST /api/webhooks/lead-stage`.
- **Deja de hacer el UPDATE directo a `leads`**: los campos que hoy escribe a
  mano (nombre, teléfono, notas, `servicio_interes`) pasan por el webhook, para
  que queden auditados en `lead_activity` como ya ocurre con la etapa.

### Nodos que se eliminan

| Nodo | Motivo |
|---|---|
| `guardar mensajes en posgress1` | el worker persiste |
| `Resolver identidad WhatsApp` | el worker llama a `resolve_whatsapp_identity` en proceso |
| Nodos `* content*` | la normalización vive en `evolution_events.py` |
| `Switch Control type` | idem |
| HTTP a `/api/webhooks/messages` | el worker hace el broadcast |
| Nodos de creación/INSERT de leads | el worker los crea al resolver identidad |

### Nodos que se conservan

Los de análisis IA (`Analyze an image`, `Analyze audio`, `Analyze video`), el
agente analista, y las llamadas HTTP a `/api/webhooks/analysis` y
`/api/webhooks/lead-stage`.

### Credenciales de RabbitMQ en n8n

Host `10.8.0.1` (por WireGuard), usuario `n8n`, vhost `dermicapro` — **sin barra
delante**: el vhost se llama `dermicapro`, y escribir `/dermicapro` en el campo
de n8n hace que el broker rechace la conexión con `vhost /dermicapro not found`.
En la URI de Evolution sí va `.../dermicapro`, pero ahí la barra es el separador
de la URI, no parte del nombre. El nodo de
n8n hace `ack` automático al terminar el flujo; hay que revisar que un fallo del
nodo de Gemini produzca `nack` y no un `ack` silencioso, o el análisis se pierde
sin dejar rastro.

### Antes de tocar nada

Exportar el workflow actual y guardarlo fuera de n8n. `rag.json` está en la raíz
del repo pero **no versionado** (contiene credenciales), así que un cambio mal
hecho no tiene vuelta atrás desde git.

---

## Riesgos

| Riesgo | Mitigación |
|---|---|
| El parser de Python no cubre un tipo raro que n8n sí manejaba | Fase 3 en sombra con tráfico real; fixtures de payloads capturados, no inventados |
| Cola creciendo sin consumidor y llenando el disco | TTL y `x-max-length` en las colas; alerta por profundidad; `q.archive.raw` con TTL corto al principio |
| Un servicio más que operar | RabbitMQ en el proyecto `data`, junto a PostgreSQL, con el mismo ciclo de vida y el mismo backup |
| Credenciales de broker filtradas desde n8n | Usuario por servicio con permisos mínimos; `guest` eliminado |
| Reentrega duplicando mensajes | Índice único sobre `wa_message_id` + handlers idempotentes; cubierto por tests |
| Deriva de esquema entre worker y API | El worker verifica `alembic head` al arrancar y se niega a consumir si no coincide |

## Lo que este plan NO resuelve

- **El envío.** Mandar mensajes sigue siendo HTTP a Evolution; `message_outbox`
  no cambia (salvo el despertador de la fase 6).
- **Que Evolution se caiga**, ni recuperar lo que WhatsApp entregó mientras la
  instancia estaba desconectada.
- **El drenado del blue-green.** Los eventos de WhatsApp dejan de perderse, pero
  una petición HTTP de un vendedor en pleno swap sigue cortándose. Es un arreglo
  aparte, independiente de esto.

## Pendiente de confirmar antes de empezar

1. **Dónde corre Evolution API**: ¿misma VPS que n8n, o una tercera? Determina si
   hay que añadir un peer al túnel WireGuard.
2. **Versión exacta de Evolution**: los nombres de las variables
   (`RABBITMQ_ENABLED`, `RABBITMQ_URI`, `RABBITMQ_EXCHANGE_NAME`,
   `RABBITMQ_GLOBAL_ENABLED`, `RABBITMQ_EVENTS_*`) y el tipo de exchange hay que
   verificarlos contra la versión desplegada. La carpeta `docs/evolution-api-2.3-mensajes/`
   sugiere 2.3, conviene confirmarlo en el contenedor.
3. **Modo global o por instancia**: con multi-tenant a la vista, el modo global
   (un exchange, el tenant en el campo `instance` del evento) escala mejor que N
   configuraciones de webhook. Confirmar que la versión desplegada lo soporta.

---

## Errores conocidos de este documento

Salieron al contrastarlo contra el código. Se dejan anotados en vez de reescribir
el plan, para que quien lo retome no repita el razonamiento.

1. **El motivo 2 de "Por qué" es falso.** Dice que el patrón de
   `routers/webhooks.py` es `except Exception: logger.exception(...)` y que por
   eso el evento se pierde. Los dos únicos bloques de ese tipo envuelven
   `trigger_inbound_message` y `trigger_stage_changed`: se tragan el fallo de la
   *automatización*, no el del mensaje. Si el handler falla, FastAPI devuelve 500.
   El motivo real es más fuerte y está en el propio diagrama: **el INSERT lo hace
   n8n antes de llamar al webhook**, así que lo que se pierde se pierde aguas
   arriba del backend.

2. **El bind propuesto para RabbitMQ copia el error que `compose.db.yml`
   documenta.** El plan propone `${RABBITMQ_BIND_IP:-127.0.0.1}:5672:5672`
   diciendo que es idéntico al de PostgreSQL; no lo es. Allí la variable es
   obligatoria y sin default (`:?`) porque `127.0.0.1` choca con la segunda
   publicación en loopback. `compose.mq.yml` ya lo resuelve.

3. **`chat_watcher` no aparece en el plan.** Sondea la base cada 60 s buscando
   mensajes insertados por fuera y hace `broadcast` + `trigger_inbound_message`.
   Tras la fase 4 queda sin propósito, y en la fase 6 corre una vez por réplica,
   cada una con su cursor.

4. **La fase 6 no desbloquea las réplicas.** El `lifespan` arranca seis bucles de
   fondo (`main.py:256-261`), no sólo el fan-out de WebSocket. Hace falta un
   `RUN_WORKERS=false` o elección de líder.

5. **La verificación de esquema no cubre el caso para el que se propone.**
   `_verify_schema_is_current()` corre una sola vez, al arrancar. En el solape
   blue-green el worker del color viejo ya pasó el check y sigue consumiendo
   después de la migración.

6. **Carrera entre el análisis de n8n y el INSERT del worker.**
   `attach_outgoing_analysis` **inserta una fila nueva** si no encuentra a cuál
   fusionar, y sólo busca filas con `sender = "vendedor"`. Para la variante
   entrante hay que hacer que no inserte y devuelva un error reintentable.

7. **El broker no puede entrar en `/health/ready`.** Ese endpoint es el
   healthcheck del contenedor y la puerta del swap blue-green: si el broker cae,
   ningún despliegue pasa aunque el HTTP funcione. Contradice la degradación que
   el propio plan diseña en la fase 6.
