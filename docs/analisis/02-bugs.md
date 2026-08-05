# Análisis 02 - Caza de bugs reales

Alcance: backend (FastAPI + SQLAlchemy 2 async + asyncpg + MinIO) y frontend
(React 19 + TanStack Query) del CRM de WhatsApp integrado con Evolution API y n8n.

Criterio: solo se reportan defectos funcionales con ruta de ejecución verificada
leyendo el código. No se reportan cuestiones de estilo. Ordenado por severidad;
la tabla resumen está al final.

---

## Bugs de severidad Crítica

### C-1. El outbox reenvía a WhatsApp un mensaje ya entregado si falla la escritura posterior a la entrega

- **Ubicación**: `backend/services/message_outbox.py:493-508` (`_process_job`),
  `288-322` (`_mark_sent`), `325-369` (`_mark_failed`)
- **Escenario concreto**:
  1. `_process_job` llama a `_send_payload` y Evolution API acepta el mensaje:
     el cliente **ya lo recibió** en WhatsApp.
  2. A continuación se llama a `_mark_sent(job, response, ...)`, que abre una
     sesión nueva y hace tres `UPDATE` más un `commit`. Cualquier fallo ahí
     —la conexión del pool se reciclaba (`pool_recycle`), un blip de red con
     PostgreSQL, un `TimeoutError` al abrir conexión (`connect_args
     {"timeout": 10}`), un deadlock con `ScheduledMessage`— lanza excepción.
  3. Esa excepción la captura el `except Exception` de `_process_job`
     (línea 506), que llama a `_mark_failed`. Como `attempts` sigue por debajo
     de `MAX_ATTEMPTS`, el trabajo vuelve a `pending` con `next_attempt_at`
     futuro.
  4. El worker lo vuelve a reclamar y **reenvía el mismo mensaje al cliente**,
     hasta 3 veces en total.
- **Causa raíz**: `_process_job` mete en el mismo `try` la llamada externa
  (efecto irreversible) y la persistencia del resultado (efecto reintentable),
  y trata cualquier fallo como "no se envió". Además el envío a Evolution no
  lleva ninguna clave de idempotencia, así que el reintento no se puede
  deduplicar del lado del receptor.
- **Variante del mismo defecto**: `_recover_stale_jobs` (`message_outbox.py:239`)
  devuelve a `pending` todo lo que quedó en `processing` más de 5 minutos, sin
  distinguir si Evolution llegó a aceptar el envío. Si el proceso muere entre
  el `POST` a Evolution y el `_mark_sent`, tras el reinicio el mensaje se envía
  otra vez.
- **Corrección propuesta**: separar los dos efectos. Envolver únicamente
  `_send_payload` en el `try` que decide reintentar; si falla `_mark_sent`,
  reintentar solo la escritura (con su propio bucle/backoff) y, si aun así no
  se puede persistir, marcar el trabajo como `sent` con `last_error` en vez de
  `pending`. Complementariamente, guardar el `wa_message_id` de la respuesta
  antes de cualquier otra escritura y comprobarlo antes de reenviar.

---

## Bugs de severidad Alta

### A-1. Los webhooks entrantes y la subida de medios quedan sin autenticación cuando `inbound_webhook_token` está vacío

- **Ubicación**: `backend/services/auth_service.py:107-118`, `backend/config.py:29`,
  `backend/main.py:274-275`
- **Escenario concreto**: `inbound_webhook_token` vale `""` por defecto
  (`config.py:29`) y `settings_service` solo lo sustituye si alguien lo cargó.
  Con el valor vacío, `verify_webhook_token` hace `if not expected: return`, es
  decir, acepta cualquier petición sin comprobar nada. Quedan abiertos:
  `POST /api/webhooks/messages`, `/reaction`, `/analysis`, `/outgoing`,
  `/lead-stage`, `/message-status`, `/resolve-whatsapp-identity` y
  `POST /api/media/upload`. Un tercero puede insertar mensajes en cualquier
  chat, cambiar la etapa de un lead (lo que además dispara automatizaciones y,
  con ellas, envíos reales de WhatsApp) o crear leads a voluntad.
- **Causa raíz**: fail-open deliberado para no romper instalaciones sin token,
  pero sin modo estricto ni aviso. Ni siquiera hay un `logger.warning` en el
  arranque, a diferencia de lo que sí se hace para la conexión sin cifrar
  (`main.py:130`).
- **Corrección propuesta**: rechazar con 401 salvo que exista una variable
  explícita de opt-out (`ALLOW_UNAUTHENTICATED_WEBHOOKS=1`); como mínimo,
  advertir en el lifespan cuando el token esté vacío.

### A-2. `{{fecha_actual}}` de las plantillas enviadas desde el chat usa la hora del servidor, no America/Lima

- **Ubicación**: `backend/routers/chats.py:98-106` (línea 104)
- **Escenario concreto**: a las 20:00 de Lima el vendedor envía una plantilla
  (interactiva o de texto) que contiene `{{fecha_actual}}`. El contenedor corre
  en UTC, `datetime.now()` devuelve 01:00 del día siguiente y el cliente recibe
  una fecha equivocada. Ventana de fallo: 19:00–23:59 hora de Lima, todos los
  días.
- **Causa raíz**: `_render_crm_value` duplica la lógica de
  `services/automation_rules.py:render_variables` pero sin
  `business_timezone()`. El original sí usa `datetime.now(business_timezone())`
  (`automation_rules.py:39`). Además `datetime.now()` es naive, así que el
  resultado depende del `TZ` del contenedor y no de una zona declarada.
- **Corrección propuesta**: borrar `_render_crm_value` de `routers/chats.py` y
  reutilizar `render_variables` de `automation_rules.py`, que ya centraliza el
  conjunto de variables y la zona horaria del negocio.

### A-3. Reentrada perdida (lost update) al fusionar reacciones sobre un mensaje

- **Ubicación**: `backend/services/db_service.py:1536-1564` (`set_message_reaction`)
- **Escenario concreto**: llegan casi simultáneamente (a) el webhook
  `POST /api/webhooks/reaction` con la reacción del cliente sobre el mensaje M
  y (b) `POST /api/chats/{id}/messages/{mid}/reaction` del vendedor sobre el
  mismo M (o la acción de automatización
  `react_to_last_customer_message`). Ambas corrutinas hacen `SELECT` de
  `reactions` (ambas leen `[]`), cada una arma su lista y hace `UPDATE`. La
  segunda en confirmar pisa a la primera y una de las dos reacciones
  desaparece del badge de forma permanente.
- **Causa raíz**: read-modify-write sobre la columna JSONB `reactions` sin
  `SELECT ... FOR UPDATE` ni actualización atómica en SQL. Es el único punto
  de merge, usado por tres caminos concurrentes.
- **Corrección propuesta**: añadir `.with_for_update()` al `select(WspMessage)`
  (la fila se identifica por el índice único de `wa_message_id`, así que el
  bloqueo es de una fila), o hacer el merge en SQL con funciones `jsonb_*`.

### A-4. Un recordatorio de tarea se consume contra un websocket zombi y no se vuelve a entregar

- **Ubicación**: `backend/services/ws_manager.py:45-54` (`send_to_user`),
  `backend/services/task_reminder.py:10-26`,
  `backend/services/productivity_service.py:115-160`
- **Escenario concreto**: el vendedor cierra la laptop o cambia de red; el
  socket queda *half-open* (el navegador no dispara `onclose` y el servidor
  no se entera). `claim_due_reminders` marca `reminder_sent_at = now` y
  `watch_task_reminders` llama a `send_to_user`. `websocket.send_json` sobre un
  socket half-open **no lanza excepción** (los bytes van al buffer del SO), así
  que `send_to_user` devuelve `True`, no se llama a `release_reminder` y el
  recordatorio queda marcado como entregado para siempre. El usuario nunca lo ve.
- **Causa raíz**: `send_to_user` toma un `send_json` sin error como prueba de
  entrega y, a diferencia de `broadcast` (`ws_manager.py:31-43`), tampoco
  depura ni cierra las conexiones muertas del registro, así que la entrada
  zombi sigue "recibiendo" para siempre.
- **Corrección propuesta**: aplicar en `send_to_user` la misma limpieza que
  `broadcast` (retirar y `close()` las conexiones que fallan) y exigir un ACK
  del cliente —o al menos no marcar `reminder_sent_at` hasta que el cliente
  confirme— antes de dar el recordatorio por entregado.

---

## Bugs de severidad Media

### M-1. `fetch_messages` retiene la conexión de PostgreSQL mientras descarga medios de MinIO

- **Ubicación**: `backend/services/db_service.py:1352-1411` y `1689-1737`
  (`_fill_media_dimensions`)
- **Escenario concreto**: al abrir un chat cuya primera página trae imágenes o
  videos sin `media_width`, `_fill_media_dimensions` corre **dentro** del
  `async with get_sessionmaker()() as session` de `fetch_messages` y hace
  `asyncio.gather` de descargas por rango contra MinIO (`asyncio.to_thread`).
  La conexión de PostgreSQL queda tomada durante toda esa E/S de red. Con
  `pool_size`/`max_overflow` acotados, unos pocos vendedores abriendo chats con
  media a la vez agotan el pool y el resto de la aplicación empieza a esperar
  10 s por conexión (`connect_args {"timeout": 10}`) y a devolver 500.
- **Causa raíz**: se mezcla en la misma sesión el trabajo de base de datos con
  E/S externa de latencia impredecible.
- **Corrección propuesta**: medir fuera de la sesión (cerrarla tras el `SELECT`,
  hacer las descargas, y abrir una sesión nueva y corta solo para el `UPDATE`
  del backfill), o mover el backfill a una tarea de fondo.

### M-2. Los trabajos atascados en `processing` solo se recuperan al reiniciar el proceso

- **Ubicación**: `backend/services/scheduled_message_service.py:130-138` y
  `231-249`; el mismo patrón en `backend/services/message_outbox.py:239-247`
  y `511-513`
- **Escenario concreto**: `_claim_due` marca la fila como `processing`. Si
  `_dispatch` muere (excepción no prevista dentro del `gather`, o el contenedor
  se reinicia justo después del claim), la fila queda en `processing` para
  siempre: `_recover_stale()` se ejecuta **una sola vez**, antes del
  `while True`. El vendedor ve el mensaje programado como "en proceso de envío"
  indefinidamente y ni siquiera puede cancelarlo, porque
  `cancel_scheduled_message` (línea 121) solo acepta `scheduled` y `failed`.
- **Causa raíz**: la recuperación de trabajos huérfanos está fuera del bucle
  del watcher.
- **Corrección propuesta**: llamar a `_recover_stale()` periódicamente dentro
  del bucle (p. ej. cada 60 s, como hace `watch_automations` con su
  housekeeping, `automation_service.py:2719-2724`).

### M-3. El envío de una plantilla oficial no comprueba que el lead exista

- **Ubicación**: `backend/routers/chats.py:619-655`
- **Escenario concreto**: `POST /api/chats/{chat_id}/templates/{template_id}`
  con un `chat_id` inexistente y una plantilla de tipo `official`. Esa rama
  llama a `enqueue_messages(...)` y retorna en la línea 655; la guarda
  `await _require_existing_lead(chat_id)` está en la línea 657, fuera de la
  rama. El `INSERT` en `wsp_messages` viola la FK `chat_id -> leads.id` y el
  cliente recibe un 500 en vez del 404 que devuelven todos los demás endpoints
  de envío.
- **Causa raíz**: la guarda de existencia quedó después del `return` temprano.
- **Corrección propuesta**: mover `await _require_existing_lead(chat_id)` al
  principio del handler, antes de resolver la plantilla.

### M-4. `insert_message` convierte un fallo de clave foránea en `NoResultFound`

- **Ubicación**: `backend/services/db_service.py:1050-1066`
- **Escenario concreto**: `attach_outgoing_analysis` o
  `reconcile_outgoing_message` (llamados desde los webhooks de n8n) invocan
  `insert_message` con `wa_message_id` no nulo sobre un `chat_id` que se borró
  entre medias. El `INSERT` levanta `IntegrityError` por la FK; el `except`
  asume que la única violación posible es el índice único de `wa_message_id`,
  hace rollback y ejecuta un `SELECT ... .one()` que no encuentra nada y lanza
  `NoResultFound`. El log y la respuesta apuntan a un problema distinto del
  real.
- **Causa raíz**: `except IntegrityError` sin discriminar el `sqlstate`.
- **Corrección propuesta**: distinguir por `exc.orig.sqlstate` (`23505` =
  unique, `23503` = FK) o usar `.one_or_none()` y re-lanzar la excepción
  original cuando no haya fila.

### M-5. Los handlers de chats devuelven 500 con el texto del error de base de datos

- **Ubicación**: `backend/routers/chats.py:259-260`, `476-477`, `435-440`
- **Escenario concreto**: `GET /api/chats/{chat_id}` (o
  `/messages`) con un `chat_id` que no es un UUID válido —por ejemplo
  `/api/chats/foo`— hace que asyncpg falle al castear contra la columna
  `PG_UUID`. En `get_messages` y `get_chats` el `except Exception` reenvía
  `str(e)` como `detail`, exponiendo al navegador la sentencia SQL y nombres
  internos; en `get_chat` ni siquiera se captura y sale un 500 sin contexto.
  Lo correcto sería un 422/404.
- **Causa raíz**: `chat_id` se declara como `str` sin validación de UUID y los
  `except Exception` genéricos serializan el error interno.
- **Corrección propuesta**: tipar el path param como `UUID` (FastAPI ya
  devuelve 422 por sí solo) y sustituir `detail=str(e)` por un mensaje fijo,
  dejando la traza en el log.

### M-6. El motor de automatizaciones puede crear notificaciones de fallo duplicadas

- **Ubicación**: `backend/services/automation_service.py:1857-1879`
  (`_notify_execution_failure`), `2614-2644` (`_release_stale_executions`),
  `backend/services/notification_service.py:28-54`
- **Escenario concreto**: una ejecución falla y se notifica al admin con
  `source_id=f"execution-failed:{execution.id}"`. Como no hay índice único
  sobre `(user_id, source_id)` ni comprobación previa, cada nuevo fallo de la
  misma ejecución —reintentos manuales, o el ciclo de
  `_release_stale_executions`, que puede reencolar hasta
  `MAX_EXECUTION_ATTEMPTS` veces— vuelve a insertar la misma notificación. El
  centro de notificaciones del admin acumula filas idénticas.
- **Causa raíz**: `source_id` está pensado como clave de deduplicación pero no
  se usa como tal en ningún sitio.
- **Corrección propuesta**: índice único parcial sobre
  `(user_id, notification_type, source_id)` y `ON CONFLICT DO NOTHING` en
  `create_system_notification`.

---

## Bugs de severidad Baja

### B-1. La caché de capacidades de Evolution no se invalida al cambiar la configuración

- **Ubicación**: `backend/services/evolution_service.py:104-145` (línea 144)
- **Escenario**: el admin cambia `evolution_api_url` o `evolution_instance`
  desde Configuración. Durante los siguientes 300 s
  `get_template_capabilities` sigue devolviendo el resultado de la instancia
  anterior, así que `_send_payload` (`message_outbox.py:455`) puede elegir el
  fallback de texto numerado o el envío interactivo nativo equivocado.
- **Causa raíz**: `_capabilities_cache` es un TTL global que
  `settings_service.update_settings` no limpia (sí limpia
  `_effective_cache`, `settings_service.py:177-178`).
- **Corrección propuesta**: exponer `reset_capabilities_cache()` y llamarlo
  desde `update_settings` al persistir cualquier clave `evolution_*`.

### B-2. La lista de flujos manuales del vendedor no se refresca nunca por invalidación

- **Ubicación**: `frontend/src/hooks/useAutomations.ts:73-96`,
  `frontend/src/hooks/useChats.ts:387-390`
- **Escenario**: el admin publica o activa un flujo visual manual. El backend
  emite `automations_updated`, que en el frontend invalida `['automations']` y
  `['automation-executions']`; la query de la lista del vendedor usa la clave
  `['automation-manual-flows', chatId]`, que no coincide con ninguna de las
  dos. `invalidateAutomations()` tampoco la incluye. El selector "Iniciar
  flujo" del vendedor sigue mostrando la lista vieja hasta que el componente se
  vuelve a montar.
- **Corrección propuesta**: añadir
  `queryClient.invalidateQueries({ queryKey: ['automation-manual-flows'] })` a
  `invalidateAutomations()` y al handler de `automations_updated`.

### B-3. `resolve_whatsapp_destination` ignora la instancia al elegir el JID de envío

- **Ubicación**: `backend/services/whatsapp_identity_service.py:271-295`
- **Escenario**: un lead con alias registrados desde más de una instancia (o
  desde la instancia sintética `"*"` que crean `create_lead` y
  `rekey_lead_phone`) devuelve el alias más reciente sin filtrar por instancia,
  mientras que `_resolve_once` sí filtra por
  `instance.in_((identity.instance, "*"))`. En una migración de instancia el
  envío puede salir por el JID equivocado.
- **Corrección propuesta**: recibir/consultar la instancia efectiva y aplicar
  el mismo filtro `in_((instance, "*"))` que usa la resolución de identidad.

### B-4. `_resolve_once` inserta alias duplicados cuando ya existe la fila bajo la instancia `"*"`

- **Ubicación**: `backend/services/whatsapp_identity_service.py:220-230`
- **Escenario**: `create_lead` registra el alias con `instance="*"`. Al llegar
  el primer webhook con `instance="dermica"`, la búsqueda de alias sí encuentra
  la fila `("*", jid)`, pero la comprobación de inserción compara
  `(identity.instance, jid)` contra `known_aliases`, no coincide y se inserta
  una segunda fila `("dermica", jid)` para el mismo lead. No rompe el índice
  único `(instance, jid)`, pero deja la tabla con alias redundantes que además
  ensucian el `order_by(updated_at)` del envío.
- **Corrección propuesta**: normalizar los alias `"*"` a la instancia real al
  resolverlos, o comparar solo por `jid` cuando ya existe una fila `"*"`.

---

## Tabla resumen

| ID | Severidad | Título | Ubicación |
|----|-----------|--------|-----------|
| C-1 | Crítica | El outbox reenvía a WhatsApp un mensaje ya entregado si falla la escritura posterior | `backend/services/message_outbox.py:493-508` |
| A-1 | Alta | Webhooks y `/api/media/upload` sin autenticación con el token vacío | `backend/services/auth_service.py:107-118` |
| A-2 | Alta | `{{fecha_actual}}` usa la hora del servidor en vez de America/Lima | `backend/routers/chats.py:104` |
| A-3 | Alta | Lost update al fusionar reacciones (JSONB sin bloqueo) | `backend/services/db_service.py:1536-1564` |
| A-4 | Alta | Recordatorio de tarea consumido por un websocket zombi | `backend/services/ws_manager.py:45-54` |
| M-1 | Media | `fetch_messages` retiene la conexión de PostgreSQL durante la E/S a MinIO | `backend/services/db_service.py:1352-1411` |
| M-2 | Media | Trabajos en `processing` solo se recuperan al reiniciar | `backend/services/scheduled_message_service.py:231-249` |
| M-3 | Media | Plantilla oficial sin verificación de lead: 500 en vez de 404 | `backend/routers/chats.py:619-655` |
| M-4 | Media | `insert_message` transforma una violación de FK en `NoResultFound` | `backend/services/db_service.py:1050-1066` |
| M-5 | Media | 500 con el texto del error de base de datos y `chat_id` sin validar | `backend/routers/chats.py:259-260, 476-477` |
| M-6 | Media | Notificaciones de fallo de automatización duplicadas | `backend/services/automation_service.py:1857-1879` |
| B-1 | Baja | Caché de capacidades de Evolution sin invalidar al cambiar ajustes | `backend/services/evolution_service.py:144` |
| B-2 | Baja | `['automation-manual-flows']` nunca se invalida | `frontend/src/hooks/useAutomations.ts:73-96` |
| B-3 | Baja | `resolve_whatsapp_destination` ignora la instancia | `backend/services/whatsapp_identity_service.py:271-295` |
| B-4 | Baja | Alias de WhatsApp duplicados frente a la instancia `"*"` | `backend/services/whatsapp_identity_service.py:220-230` |

---

## Zonas revisadas sin hallazgos que sostener

Se dejan anotadas para no repetir el trabajo:

- **Idempotencia de mensajes entrantes**: el índice único parcial
  `idx_wsp_messages_wa_message_id` más el `on_conflict_do_nothing` sobre
  `(rule_id, event_key)` de `schedule_automation_event` cubren correctamente el
  reenvío del webhook y el descubrimiento redundante de `chat_watcher` /
  `_discover_recent_inbound_messages`: las tres rutas derivan la misma
  `event_key` (`message:{wa_message_id or id}`).
- **Regresión de estados de entrega**: `update_message_status` compara el rango
  dentro del `WHERE`, de modo que un webhook fuera de orden no baja un READ a
  DELIVERY_ACK.
- **Orden de envío por chat**: la subconsulta `has_earlier_unsent` de
  `_claim_batch` garantiza que solo el trabajo más antiguo pendiente de cada
  chat se reclame por ronda.
- **Zona horaria del dashboard**: `dashboard_service` calcula los cortes con
  UTC-5 y agrupa con `timezone('America/Lima', created_at)`; es correcto.
- **Traversal de rutas en `/media/{filename}`**: `_media_filename` y
  `_local_path_from_filename` rechazan separadores y resuelven contra
  `MEDIA_DIR`.
- **Ciclos en el constructor de flujos**: `validate_graph_topology` verifica
  alcanzabilidad y ausencia de ciclos antes de publicar.
