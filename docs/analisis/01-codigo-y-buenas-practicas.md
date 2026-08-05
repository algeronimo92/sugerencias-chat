# Análisis 01 — Calidad de código y buenas prácticas

> Estado: COMPLETO. Fecha: 2026-08-05.
> Alcance: `backend/` (FastAPI + SQLAlchemy async) y `frontend/src/` (React 19 + TS).
> Este documento es de solo lectura sobre el código: no se ha modificado ningún fichero de la aplicación.

## Resumen ejecutivo

- **Dos ficheros concentran el 20 % del backend.** `automation_service.py` (2737
  líneas, 72 funciones de nivel superior) es en realidad siete módulos en uno, y
  `db_service.py` (2001 líneas, 90 funciones) es un *God Object*. Todo lo demás de
  este informe se refactoriza con dificultad mientras esos dos no se partan (B1.1,
  B1.2).
- **La misma lógica está escrita tres veces y las copias ya divergieron.** El
  renderizado de variables `{{…}}` existe en `automation_rules`, en
  `routers/chats.py` y en el frontend, y la versión del router usa otra zona
  horaria: eso no es deuda estética, es un bug de producción (B2.1, F2.5).
- **Hay un bug real en la ruta de error del motor de automatizaciones**: el handler
  de excepción genérica de `_run_visual_execution` pierde `deps` al llamar a
  `_notify_execution_failure`, de modo que el aviso de fallo falla también (B3.2).
- **Los `except Exception` devuelven el mensaje interno al cliente como HTTP 500** y
  no dejan traza. Se filtran detalles de implementación y a la vez se pierde la
  información necesaria para diagnosticarlos (B4.1, B4.2).
- **El backend no tiene linter ni verificador de tipos, y el frontend no está en
  modo `strict`.** Es la causa estructural de buena parte de lo anterior: nada
  impide que vuelva a aparecer (B5, F4.1, F6.1).
- **251 firmas devuelven `dict` sin parametrizar** como tipo de todo el dominio, con
  lo que el contrato real entre capas solo existe en la cabeza de quien lo escribió
  (B5.1).
- **`AutomationDeps` existe pero se ignora** en la mayoría de accesos a base de
  datos, así que la inyección de dependencias que el diseño previó no llega a
  cumplirse y el motor no es testeable de forma aislada (B3.1).
- **En el frontend, `MainLayout` re-implementa el enrutado que React Router ya
  resolvió**, y `useChatUpdates` acumula 248 líneas con tres responsabilidades y un
  `catch` que traga cualquier error del tiempo real en silencio (F1.1, F1.2, F3.1).
- **El editor de las 12 acciones de automatización está escrito dos veces** (más una
  tercera definición en el backend), y conviven tres formatos de fecha distintos:
  `es-PE`, `es-AR` y el locale del navegador (F2.1, F2.2).
- **130 líneas superan los 300 caracteres y la peor tiene 4167**, lo que hace
  materialmente irrevisable en diff cerca del 15 % del frontend. Formatear debería
  ir en un commit aislado, antes de tocar esos ficheros (F5.1).

## Metodología y métricas base

Se midió con `wc -l` el tamaño de todos los ficheros y con un script AST el largo y
la profundidad de anidamiento de cada función Python.

### Backend — ficheros más grandes (líneas)

| Fichero | Líneas |
|---|---|
| `backend/services/automation_service.py` | 2737 |
| `backend/services/db_service.py` | 2001 |
| `backend/routers/chats.py` | 791 |
| `backend/models/schemas.py` | 655 |
| `backend/db/models.py` | 652 |
| `backend/services/media_storage.py` | 563 |
| `backend/services/evolution_service.py` | 527 |
| `backend/services/message_outbox.py` | 523 |
| `backend/routers/templates.py` | 437 |
| `backend/services/productivity_service.py` | 430 |

Total backend (sin tests ni alembic): ~23.3k líneas. Los dos primeros ficheros
concentran el 20 % del código de la aplicación.

### Backend — funciones más largas / más anidadas

| Función | Líneas | Anidamiento máx. | Ubicación |
|---|---|---|---|
| `_run_visual_execution` | 345 | 5 | `backend/services/automation_service.py:1899` |
| `validate_automation_rule` | 186 | **11** | `backend/services/automation_service.py:489` |
| `validate_visual_flow` | 134 | 7 | `backend/services/automation_service.py:863` |
| `_resolve_once` | 120 | 4 | `backend/services/whatsapp_identity_service.py:137` |
| `_compute_dashboard_metrics` | 116 | 1 | `backend/services/dashboard_service.py:31` |
| `_validate_interactive_config` | 109 | 4 | `backend/routers/templates.py:81` |
| `simulate_visual_flow` | 104 | 7 | `backend/services/automation_service.py:1389` |
| `fetch_messages` | 103 | 3 | `backend/services/db_service.py:1331` |
| `fetch_chats` | 102 | 4 | `backend/services/db_service.py:399` |
| `send_template` | 88 | 2 | `backend/routers/chats.py:620` |
| `validate_graph_topology` | 61 | 6 | `backend/services/automation_rules.py:153` |

### Frontend — ficheros más grandes (líneas)

| Fichero | Líneas |
|---|---|
| `frontend/src/components/TemplatesPage.tsx` | 838 |
| `frontend/src/components/VisualFlowBuilder.tsx` | 789 |
| `frontend/src/components/flow/FlowCanvas.tsx` | 771 |
| `frontend/src/types/index.ts` | 693 |
| `frontend/src/hooks/useChats.ts` | 657 |
| `frontend/src/App.tsx` | 613 |
| `frontend/src/components/ChatList.tsx` | 604 |
| `frontend/src/utils/message.ts` | 518 |
| `frontend/src/components/ChatComposer.tsx` | 513 |
| `frontend/src/components/KanbanBoard.tsx` | 502 |

---

## Backend

### B1. Módulos con demasiadas responsabilidades

#### [ALTO] B1.1 — `automation_service.py` es siete módulos en uno (2737 líneas, 72 funciones de nivel superior)

**Qué está mal.** Un único fichero contiene, sin separación física alguna:

1. CRUD de reglas (`list_automation_rules` en `backend/services/automation_service.py:182`
   … `delete_automation_rule:306`) y de ejecuciones (`:352`–`:487`).
2. Validación/normalización de reglas clásicas (`validate_automation_rule:489`, 186 líneas).
3. Validación/normalización del flujo visual y sus versiones
   (`normalize_visual_draft:791`, `validate_visual_flow:863`, `publish_visual_flow:1028`,
   `list_flow_versions:1061`, `restore_flow_version:1085`).
4. Disparadores de dominio (`trigger_lead_created:1246`, `trigger_stage_changed:1262`,
   `trigger_inbound_message:1280`).
5. Los 12 handlers de acción (`_action_create_task:1508` … `_action_send_attachment:1745`).
6. El intérprete del grafo (`_run_visual_execution:1899`, `_run_execution:2293`).
7. El *scheduler*/reaper en segundo plano (`_discover_recent_inbound_messages:2408`,
   `_discover_wait_any_replies:2461`, `_discover_timed_events:2527`,
   `_release_stale_executions:2614`, `backfill_automation_state:2647`,
   `watch_automations:2714`).

**Por qué importa.** Cualquier cambio en la UI de reglas obliga a recompilar mentalmente
el intérprete y el scheduler. El fichero ya arrastra un módulo de descarga
(`automation_rules.py`) creado precisamente para poder testear sin base de datos, pero
la separación se quedó a medias: la lógica pura sigue mezclada con I/O en las 2737
líneas restantes. El propio código lo admite en `backend/services/automation_deps.py:10-12`
("es también la señal de que `_execute_action` hace demasiado").

**Refactorización propuesta.** Partir en un paquete `services/automations/`:
`repository.py` (CRUD + queries), `validation.py` (reglas clásicas),
`flows.py` (normalize/validate/publish/versions), `actions/` (un módulo por handler,
con el registro `ACTION_HANDLERS` como punto de extensión), `engine.py`
(`_run_execution`/`_run_visual_execution`) y `scheduler.py` (los `_discover_*` y
`watch_automations`). Mantener `automation_service.py` como fachada de reexportación
para no romper los ~15 imports existentes. **Esfuerzo: L.**

#### [ALTO] B1.2 — `db_service.py` es un *God Object* de 2001 líneas con 90 funciones

**Qué está mal.** `backend/services/db_service.py` mezcla siete agregados distintos:
leads/chats (`fetch_chats:399`, `create_lead:854`, `rekey_lead_phone:955`),
mensajes (`insert_message:1023`, `fetch_messages:1331`, `set_message_reaction:1536`,
`reconcile_outgoing_message:1641`), kanban (`fetch_kanban_counts:554`…`fetch_kanban_stage:639`),
sugerencias IA (`get_cached_suggestion:779`, `cache_suggestion:842`),
etiquetas (`list_tags:1740`…`remove_tag:1834`),
actividad del lead (`list_lead_activity:1863`) y **usuarios/auth**
(`get_user_by_email:1912`, `create_user:1932`, `set_user_password:1985`,
`seed_admin_if_needed:1993`). Las cuatro excepciones de dominio del sistema
(`LeadAlreadyExistsError:35`, `EmailAlreadyExistsError:39`, `TagAlreadyExistsError:43`,
`LastAdminError:47`) también viven aquí, obligando a que `routers/users.py` importe
del módulo de chats para capturar un error de usuarios.

**Por qué importa.** Es el punto de acoplamiento de todo el backend: prácticamente
cualquier router o servicio lo importa, y cualquier cambio en él invalida el
razonamiento sobre todo lo demás. La cohesión es baja (usuarios y mensajes no
comparten nada) y el acoplamiento aferente es máximo.

**Refactorización propuesta.** Dividir en `repositories/leads.py`, `messages.py`,
`kanban.py`, `tags.py`, `users.py`, `suggestions.py` + `repositories/errors.py`
para las excepciones. Los helpers de búsqueda (`_escape_like:205` … `_matched_message_subquery:322`)
van a `repositories/search.py`. Reexportar desde `db_service` durante la transición.
**Esfuerzo: L.**

#### [MEDIO] B1.3 — `fetch_chats` recibe 16 parámetros posicionales y el router los pasa por posición

**Qué está mal.** `backend/services/db_service.py:399-416` declara 16 parámetros;
`backend/routers/chats.py:239-256` los pasa **todos posicionalmente**, sin nombres:

```python
return await fetch_chats(
    search.strip() if search else None,
    cursor_ts, cursor_id, limit, unread_only,
    parsed_stages, parsed_tag_ids, tag_mode, service,
    seller_id, origin, last_sender, inactive_days,
    waiting_time, cursor_rank, automation_paused,
)
```

**Por qué importa.** Insertar o reordenar un filtro rompe silenciosamente la llamada
(los tipos son compatibles: varios `str | None` consecutivos). Es exactamente el tipo
de fallo que ningún test de tipos detecta y que sí llega a producción.

**Refactorización propuesta.** Un `@dataclass(frozen=True) class ChatFilters` (o un
modelo Pydantic reutilizado por el endpoint) que el router construya y el repositorio
consuma. Reduce la firma a `fetch_chats(filters: ChatFilters, page: CursorPage)`.
**Esfuerzo: M.**

#### [MEDIO] B1.4 — `_run_visual_execution`: 345 líneas y siete tipos de nodo en un solo bucle

**Qué está mal.** `backend/services/automation_service.py:1899-2243`. Dentro de un
`for _ in range(MAX_FLOW_NODES + 1)` hay una cascada de `if node["type"] == …`
(TRIGGER `:1961`, CONDITION `:1975`, ACTION `:1998`, WAIT `:2015`, WAIT_ANY `:2035`,
QUESTION `:2127`, END implícito `:2194`). El bloque
`saved = await _persist_visual_execution(..., AutomationExecutionStatus.RUNNING, ...)`
+ `if not saved: return  # cancelada externamente` está **copiado literalmente 5 veces**
(`:1963`, `:1986`, `:2003`, `:2115`, `:2182`).

**Por qué importa.** Añadir un tipo de nodo obliga a tocar esta función y a recordar
el patrón de persistencia; olvidarse del `if not saved` reintroduce el bug de
"ejecución cancelada que sigue corriendo".

**Refactorización propuesta.** Extraer un `_advance(execution, results, next_id, path, ...)`
que encapsule persistir + comprobar cancelación, y un dict
`NODE_HANDLERS: dict[FlowNodeType, Callable]` que devuelva un
`NodeOutcome(next_id | None, terminal_status | None)`. El bucle queda en ~30 líneas.
**Esfuerzo: M.**

#### [MEDIO] B1.5 — `validate_automation_rule`: 186 líneas y anidamiento 11

**Qué está mal.** `backend/services/automation_service.py:489-674` es la función con
mayor profundidad de anidamiento de todo el backend (11 niveles). Contiene una cadena
`if/elif` de 10 ramas sobre `action_type` (`:522`–`:612`), cada una con su propia
validación ad hoc, y a continuación un bloque de 4 consultas de integridad referencial
(`:628`–`:658`) que abre sesión de base de datos dentro de lo que por nombre parece
una validación pura.

**Por qué importa.** Cada nuevo tipo de acción añade una rama de 10–20 líneas aquí,
otra en `ACTION_HANDLERS` y otra en el catálogo del frontend
(`frontend/src/domain/automationCatalog.ts`). Tres sitios sin ninguna verificación
cruzada.

**Refactorización propuesta.** Un modelo Pydantic discriminado por `type`
(`Annotated[Union[CreateTaskAction, AssignSellerAction, …], Field(discriminator="type")]`)
sustituye las 10 ramas por declaraciones y da mensajes de error automáticos.
La comprobación de existencia de usuarios/etiquetas/plantillas/medios se extrae a
`_assert_references_exist(refs: ReferencedIds)`. **Esfuerzo: M.**

### B2. Duplicación de lógica

#### [ALTO] B2.1 — El renderizado de variables `{{…}}` está implementado tres veces, y una de ellas con distinta zona horaria

**Qué está mal.** La misma sustitución existe en:

- `backend/services/automation_rules.py:36` `render_variables()` — usa
  `datetime.now(business_timezone())` (America/Lima) y expone `unknown_variables()`.
- `backend/routers/chats.py:98` `_render_crm_value()` — copia byte a byte de la anterior,
  salvo que usa `datetime.now()` (**hora local del servidor, UTC en el contenedor**).
- `frontend/src/utils/templates.ts:13` — tercera copia, con `toLocaleDateString()`
  (formato del navegador, no `dd/mm/yyyy`).

Además la lista de variables permitidas está triplicada:
`backend/services/automation_rules.py:23`, `backend/routers/templates.py:21` y
`frontend/src/components/TemplatesPage.tsx:77`.

**Por qué importa.** No es solo duplicación: es un **bug latente**. Entre las 19:00 y
la medianoche de Lima, `{{fecha_actual}}` en una plantilla enviada a mano
(`routers/chats.py`) muestra el día siguiente, mientras que la misma plantilla enviada
por una automatización muestra el día correcto. Y la previsualización del frontend
muestra un tercer formato.

**Refactorización propuesta.** `routers/chats.py` debe importar `render_variables`
de `automation_rules` y borrar `_render_crm_value`. Exponer la lista de variables
por API (`GET /api/templates/variables`) o generarla desde un único origen para el
frontend. **Esfuerzo: S.**

#### [ALTO] B2.2 — La validación de plantillas interactivas está duplicada entre router de plantillas y router de chats

**Qué está mal.** `backend/routers/templates.py:81` `_validate_interactive_config`
(109 líneas) valida la plantilla al guardarla; `backend/routers/chats.py:119`
`_validate_rendered_interactive_message` (52 líneas) re-valida lo mismo al enviarla.
Los límites están escritos dos veces y ya han divergido en la forma de expresarlos:
título ≤60 (`templates.py` vs `chats.py:130`), pie ≤60 (`chats.py:132`), botón 1–20
(`chats.py:138`), sección ≤24 (`chats.py:155`), fila 24/72/200 (`chats.py:162-167`).
La regex de URL `https://[^\s]{1,2040}` aparece en ambos.

**Por qué importa.** Un cambio de límite de WhatsApp obliga a editar dos ficheros de
capas distintas; si solo se edita uno, se guardan plantillas que luego el envío rechaza
(o al revés, se envían plantillas que WhatsApp rechaza con un 400 opaco).

**Refactorización propuesta.** Un módulo `services/interactive_templates.py` con las
constantes (`MAX_TITLE`, `MAX_FOOTER`, `MAX_BUTTON_LABEL`, …) y una función
`validate_interactive(interactive_type, description, config) -> list[str]` que ambos
routers invoquen — el de plantillas sobre el texto con variables, el de chats sobre el
texto ya renderizado. **Esfuerzo: S.**

#### [MEDIO] B2.3 — Cuatro peticiones GET a Evolution con el mismo boilerplate copiado

**Qué está mal.** `backend/services/evolution_service.py` tiene un helper `_post` (`:88`)
pero ningún `_get`. El bloque

```python
started_at = perf_counter()
try:
    response = await _client().get(url, headers=headers, timeout=20.0)
finally:
    record_external_duration("evolution", (perf_counter() - started_at) * 1000)
if response.is_error:
    raise EvolutionApiError(f"Evolution API respondió {response.status_code} …")
```

está repetido en `get_template_capabilities:117-125`, `get_connection_state:432-442`,
`connect_instance:482-490` y `logout_instance:518-526`. Igualmente,
`api_url, api_key, instance = await _config()` + `url = f"{api_url.rstrip('/')}/…"`
aparece 14 veces.

**Por qué importa.** Olvidar el `finally` en una función nueva rompe silenciosamente
las métricas `Server-Timing` que el middleware de `main.py:236` publica. Y cambiar el
manejo de errores (p. ej. distinguir 429) obliga a editar cuatro sitios.

**Refactorización propuesta.** Un `_request(method, path, *, json=None, timeout)` único
que resuelva config, arme la URL, mida y traduzca errores; `_post`/`_get` quedan como
envoltorios de una línea. **Esfuerzo: S.**

#### [MEDIO] B2.4 — Cinco bucles *watcher* con el mismo esqueleto

**Qué está mal.** `watch_chats` (`backend/services/chat_watcher.py:14`),
`watch_task_reminders` (`backend/services/task_reminder.py:10`),
`watch_message_outbox` (`backend/services/message_outbox.py:511`),
`watch_scheduled_messages` (`backend/services/scheduled_message_service.py:231`) y
`watch_automations` (`backend/services/automation_service.py:2714`) repiten
`while True: try: …; except Exception: logger.exception(...); await asyncio.sleep(N)`.
El arranque y la parada también están copiados 5 veces en `backend/main.py:195-215`
(5 `create_task`, 5 `cancel`, 5 `contextlib.suppress`).

Además, la protección es **inconsistente**: cuatro de los cinco incluyen
`except asyncio.CancelledError: raise` explícito y `chat_watcher.py:29` no
(en Python ≥3.8 `CancelledError` hereda de `BaseException`, así que la guarda explícita
es redundante en los cuatro — el problema es que el lector no puede saber cuál criterio
es el correcto).

**Refactorización propuesta.** Un `services/background.py` con
`async def run_periodically(name: str, tick: Callable[[], Awaitable[None]], seconds: float)`
y un registro `BACKGROUND_TASKS: list[BackgroundTask]` que `lifespan` recorra para
arrancar y parar. Reduce `main.py:195-215` a dos bucles de 3 líneas. **Esfuerzo: S.**

#### [MEDIO] B2.5 — El literal `"DermicaPro"` y el payload `{"type": "chats_updated", …}` esparcidos por todo el backend

**Qué está mal.** El pie por defecto de los mensajes interactivos está escrito como
literal en `backend/routers/chats.py:95` (`DEFAULT_INTERACTIVE_FOOTER`),
`backend/services/evolution_service.py:248` y `:267`, y **cuatro veces** en
`backend/services/message_outbox.py:460,465,472,478,487`. El payload de broadcast
`{"type": "chats_updated", "chat_id": …, "reason": …}` se construye a mano en 39 sitios
(`grep -c chats_updated` = 39, con 70 llamadas a `manager.broadcast`), con el `reason`
como *string* libre: `"stage_changed"`, `"lead_created"`, `"lead_updated"`,
`"tag_changed"`, `"outbound_queued"`, `"outbound_message"`, `"read"`, `"reaction"`,
`"analysis"`, `"message_status"`, `"inbound_message"`, `"external_message"`.

**Por qué importa.** El frontend hace *switch* sobre esos `reason`
(`frontend/src/hooks/useChats.ts`); un typo en el backend no falla en ningún test y
degrada el refresco en silencio.

**Refactorización propuesta.** `services/ws_events.py` con un `class ChatUpdateReason(StrEnum)`
y helpers `broadcast_chat_updated(chat_id, reason, **extra)`. El pie por defecto pasa a
`config.settings` o a una constante única en `evolution_service`. **Esfuerzo: S.**

### B3. Acoplamiento a Evolution API / n8n / MinIO

#### [ALTO] B3.1 — `AutomationDeps` existe pero se salta en la mayoría de los accesos a base de datos

**Qué está mal.** `backend/services/automation_deps.py` es un buen patrón de inyección
(y su docstring explica exactamente por qué existe). Sin embargo, dentro de
`automation_service.py` hay **31 usos de `get_sessionmaker()()`** frente a solo
**7 de `deps.session()`**. Ejemplos: `validate_automation_rule:628`,
`_resolve_flow_definition:1891` (que además **recibe `deps` y no lo usa**),
`schedule_automation_event`, `_discover_*`.

**Por qué importa.** La inyección solo cubre parte de la superficie, así que los tests
del motor siguen necesitando PostgreSQL real para las rutas de validación,
resolución de definición y descubrimiento. La promesa del módulo no se cumple y quien
escribe un test nuevo no sabe si su doble se usará o no.

**Refactorización propuesta.** Sustituir todos los `get_sessionmaker()()` de
`automation_service.py` por `deps.session()`, propagando `deps` en las funciones que
hoy no lo reciben (`validate_automation_rule`, `schedule_automation_event`, los
`_discover_*`). **Esfuerzo: M.**

#### [ALTO] B3.2 — Bug: el handler de excepción genérica de `_run_visual_execution` pierde `deps`

**Qué está mal.** `backend/services/automation_service.py:2243`:

```python
await _notify_execution_failure(rule, execution, str(exc))
```

Falta el argumento `deps`, que sí se pasa en la rama gemela de la línea `:2230`
(`await _notify_execution_failure(rule, execution, str(exc), deps)`).

**Por qué importa.** Ante un error inesperado —justo el caso en que más importa
observar el comportamiento— la notificación usa `DEFAULT_DEPS`, es decir base de datos
y WebSocket reales. En los tests eso significa que la ruta de fallo inesperado escribe
donde no debe (o revienta con un error distinto que enmascara el original).

**Refactorización propuesta.** Añadir `deps` a la llamada. **Esfuerzo: S** (una línea),
pero conviene añadir un test que fuerce una excepción no contemplada.

#### [MEDIO] B3.3 — Estado global mutable de módulo en tres servicios

**Qué está mal.**
- `backend/services/evolution_service.py:18-19`: `_http_client` y `_capabilities_cache`
  globales. El caché de capacidades (TTL 300 s, `:144`) no tiene función de purga, así
  que un test que ejercite el fallback interactivo contamina a los siguientes.
- `backend/services/db_service.py:213`: `_unaccent_enabled` global mutado por
  `set_unaccent_enabled` desde `main.py:158`. Cambia el resultado de todas las
  búsquedas y no hay forma de fijarlo por test salvo mutando el módulo.
- `backend/services/automation_service.py`: `_wake` (`asyncio.Event` global, ver
  `watch_automations:2735`) acopla los routers al bucle de fondo.

**Refactorización propuesta.** Encapsular en objetos con ciclo de vida
(`EvolutionClient`, `SearchCapabilities`) resueltos por dependencia de FastAPI, o
como mínimo exponer `reset_*()` invocado por una fixture de `conftest.py`. **Esfuerzo: M.**

#### [MEDIO] B3.4 — MinIO: los errores reales se descartan y solo se conserva el nombre de la clase

**Qué está mal.** En `backend/services/media_storage.py` el patrón
`raise MediaStorageError(f"No se pudo … : {type(exc).__name__}") from exc` se repite en
`:180`, `:490`, `:507`, `:521`, `:557`. El mensaje resultante es, por ejemplo,
"No se pudo guardar en MinIO: S3Error" — sin bucket, sin código de error, sin objeto.

**Por qué importa.** `S3Error` cubre desde credenciales inválidas hasta bucket
inexistente o disco lleno. Con este mensaje, diagnosticar exige reproducir a mano.
El `from exc` conserva la traza, pero ese detalle solo llega al log si alguien registra
la excepción — y en `routers/media_library.py:56` y `:102` se captura y se descarta.

**Refactorización propuesta.** Registrar con `logger.exception` en el punto de captura
e incluir contexto operativo (bucket, `object_name`) en el mensaje. **Esfuerzo: S.**

#### [BAJO] B3.5 — n8n solo se acopla en un punto, pero sin abstracción de reintento

`backend/services/n8n_service.py:35` `call_n8n` (63 líneas) concentra bien la
integración, pero la política de timeouts/reintentos está incrustada en la función y
no se comparte con `evolution_service`, que usa timeouts literales distintos por
endpoint (10.0, 20.0, 30.0, 60.0 repartidos por todo el fichero, sin constantes).
**Esfuerzo: S** (extraer constantes con nombre).

### B4. Manejo de errores y logging

#### [ALTO] B4.1 — `except Exception` que devuelve al cliente el mensaje interno como 500

**Qué está mal.** `backend/routers/chats.py:259-260` y `:476-477`:

```python
except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))
```

Sin `logger.exception`. Lo mismo en `backend/routers/suggestions.py:48`.

**Por qué importa.** Dos consecuencias, ambas malas: (1) el detalle de un error de
SQLAlchemy —que puede incluir el SQL y nombres de columnas— viaja al navegador;
(2) no queda registro en el log, así que el equipo se entera del fallo solo si el
usuario lo reporta. Es literalmente lo contrario de lo deseable: se filtra al que no
debe verlo y se oculta al que debe.

**Refactorización propuesta.** Un `@app.exception_handler(Exception)` en `main.py` que
haga `logger.exception` y devuelva un 500 genérico, y borrar estos `except Exception`
de los routers. **Esfuerzo: S.**

#### [MEDIO] B4.2 — Excepciones tragadas sin registro en rutas de datos

**Qué está mal.**
- `backend/services/media_storage.py:374-375` (`except Exception: continue` dentro del
  bucle de `image_dimensions`) y `:464-465` (`except Exception: return None` en
  `_mp4_dimensions`): si PIL o el parseo MP4 fallan siempre, el sistema deja de
  calcular dimensiones para toda la biblioteca y **no hay ni una línea de log**.
- `backend/services/ws_manager.py:28` y `:42-43`: `except Exception: pass` en el envío
  por WebSocket.
- `backend/routers/media_library.py:56` y `:102`, `backend/routers/templates.py:337`,
  `backend/routers/media.py:104`: capturas mudas alrededor de operaciones de borrado
  de ficheros.

**Por qué importa.** Las dimensiones ausentes provocan saltos de layout en el hilo de
chat (el frontend usa `width`/`height` para reservar espacio); sin log, la causa es
invisible.

**Refactorización propuesta.** `logger.debug`/`logger.warning` con el `media_url` en
cada captura silenciosa. Donde el `pass` es intencional (limpieza best-effort),
documentarlo en una línea de comentario. **Esfuerzo: S.**

#### [MEDIO] B4.3 — Logging bilingüe e inconsistente en formato

**Qué está mal.** Conviven mensajes en inglés y en español dentro del mismo módulo:
`backend/services/automation_service.py:2232` ("Unexpected error running visual
automation execution %s") junto a `:1879` ("No se pudo notificar el fallo de la
ejecución %s"); `backend/services/message_outbox.py:500` ("Outbox %s message %s sent
via Evolution in %.0fms") junto a los mensajes en español del resto de servicios.
`backend/main.py` es íntegramente en inglés salvo `_log_database_encryption:130`.

Tampoco hay configuración de logging centralizada: no existe `logging.basicConfig` ni
`dictConfig` en el arranque, así que el formato depende de lo que ponga uvicorn.

**Refactorización propuesta.** Fijar el idioma (español, coherente con el resto del
proyecto y con los mensajes de usuario) y añadir un `logging_config.py` invocado en
`lifespan` con formato estructurado. **Esfuerzo: S.**

#### [BAJO] B4.4 — Doble criterio en el manejo de `CancelledError`

Ver B2.4: cuatro watchers escriben `except asyncio.CancelledError: raise` y uno no
(`backend/services/chat_watcher.py:29`). Como en Python ≥3.8 `CancelledError` no
desciende de `Exception`, la guarda es redundante; conviene unificar (borrarla en los
cuatro o añadirla en el quinto) para que no parezca que hay un motivo. **Esfuerzo: S.**

### B5. Tipado

#### [ALTO] B5.1 — `dict` sin parametrizar como tipo de retorno de todo el dominio (251 firmas)

**Qué está mal.** `grep ": dict\b|-> dict\b|list[dict]"` sobre `backend/services` y
`backend/routers` da **251 coincidencias**. Los objetos de dominio circulan como
diccionarios anónimos de extremo a extremo: `fetch_chat() -> dict | None`
(`backend/services/db_service.py:503`), `_row_to_chat(row, tags) -> dict` (`:74`),
`_rule_dict(row) -> dict` (`backend/services/automation_service.py:134`),
`_execution_dict(row) -> dict` (`:160`), y los 12 handlers de acción declaran
`async def _action_x(action, chat, execution, rule, deps) -> dict` (`:1508`–`:1745`)
**sin ninguna anotación en los parámetros**.

**Por qué importa.** Existen ya los modelos Pydantic en `backend/models/schemas.py`
(655 líneas), pero solo se usan en el borde HTTP. Dentro, cualquier acceso
`chat["vendedor_id"]` es una apuesta: un cambio de clave en `_row_to_chat` rompe
`_resolve_recipient` (`:1495`) o `_matches_flow_condition` (`:1358`) y nada lo detecta
hasta ejecución. Concretamente `_action_*` recibe `chat` producido por `_row_to_chat`
en unos caminos y por `deps.fetch_chat` en otros — no hay garantía de que sean la
misma forma.

**Refactorización propuesta.** Empezar por lo barato: un `TypedDict` `ChatDict` /
`RuleDict` / `ExecutionDict` en `backend/domain_types.py` (que ya existe, 135 líneas,
pero solo aloja enums) y anotar `_row_to_chat`, `_rule_dict`, `_execution_dict` y las
firmas de los handlers. Sin cambiar una línea de lógica se gana verificación estática.
**Esfuerzo: M.**

#### [MEDIO] B5.2 — Parámetros sin anotar en las funciones más críticas

**Qué está mal.** Ejemplos concretos:
`def _ts(value):` (`backend/services/automation_service.py:119`),
`def _rule_dict(row) -> dict:` (`:134`), `def _execution_dict(row) -> dict:` (`:160`),
los 12 `async def _action_*(action, chat, execution, rule, deps) -> dict`
(`:1508`–`:1745`), `def _render_interactive_config(value, chat: dict):` (sin retorno,
`backend/routers/chats.py:109`), `def _chat_columns(last_message):`
(`backend/services/db_service.py:349`), `def _has_tag_condition(tag_id: int):`
(sin retorno, `:192`), `def _unaccent_ilike(column, pattern: str):` (`:221`).

**Por qué importa.** Son precisamente los puntos de unión entre capas; sin anotación,
ningún analizador puede propagar tipos y el IDE no ayuda.

**Refactorización propuesta.** Anotar y activar `mypy`/`pyright` en modo básico sobre
`backend/services` en CI (aunque sea con `--ignore-missing-imports` y sin `strict`).
**Esfuerzo: M.**

#### [BAJO] B5.3 — `Any` en los bordes de webhook

`backend/routers/webhooks.py:38` (`body: dict[str, Any] = Body(...)`) y `:306`
(`body: dict[str, Any] | list[dict[str, Any]]`) aceptan cualquier cosa y delegan la
validación a `parse_evolution_identity` / `parse_message_status_events`. Es defendible
(el formato de Evolution varía entre versiones) pero conviene documentar el contrato
con un modelo Pydantic laxo + `model_config = ConfigDict(extra="allow")` para que
FastAPI genere el esquema OpenAPI. **Esfuerzo: S.**

### B6. Funciones largas y anidamiento

Resumen cuantitativo (script AST sobre `backend/`, excluidos tests y alembic):

- **11 funciones ≥ 100 líneas.** La mayor, `_run_visual_execution`, con 345 (B1.4).
- **Anidamiento ≥ 6 en 4 funciones**: `validate_automation_rule` (11),
  `validate_visual_flow` (7), `simulate_visual_flow` (7),
  `validate_graph_topology` (6, `backend/services/automation_rules.py:153`).
- `backend/services/whatsapp_identity_service.py:137` `_resolve_once`: 120 líneas para
  resolver la identidad de WhatsApp; buen candidato a partir en
  `_match_by_phone` / `_match_by_lid` / `_create_provisional`.
- `backend/services/dashboard_service.py:31` `_compute_dashboard_metrics`: 116 líneas
  planas (anidamiento 1) — es una lista de agregaciones, más fácil de dividir en
  funciones por bloque de métrica. **Esfuerzo por función: S–M.**

#### [MEDIO] B6.1 — `simulate_visual_flow` es un tercer intérprete del grafo

`backend/services/automation_service.py:1389-1492` reimplementa el recorrido de nodos
que ya hacen `_run_visual_execution` (`:1899`) y, parcialmente, `validate_visual_flow`
(`:863`). Los tres recorren `nodes`/`edges` con criterios propios para decidir el
siguiente handle. Un cambio en la semántica de `wait_any` obliga a tocar los tres.
**Refactorización:** extraer un `FlowWalker` que resuelva `next_handle(node, context)`
y que simulación y ejecución compartan. **Esfuerzo: M.**

#### [BAJO] B6.2 — Sangría engañosa en las llamadas a `_persist_visual_execution`

En 12 llamadas dentro de `_run_visual_execution` el argumento `deps=deps,` aparece
**des-indentado respecto al resto de argumentos** (`:1916`, `:1943`, `:1970`, `:1993`,
`:2010`, `:2032`, `:2073`, `:2111`, `:2122`, `:2167`, `:2189`, `:2206`, `:2228`, `:2241`).
Es sintácticamente válido pero visualmente sugiere que la llamada terminó. Un
formateador (`ruff format` / `black`) lo resuelve de una pasada. **Esfuerzo: S.**

#### [BAJO] B6.3 — `message_status_webhook` hace N+1 escrituras por lote

`backend/routers/webhooks.py:321-329`: por cada evento del lote se hace un
`update_message_status` y, condicionalmente, un `mark_chat_read_from_whatsapp_receipt`,
cada uno abriendo su propia sesión. Evolution envía `MESSAGES_UPDATE` en lotes (el
propio docstring lo dice, `:311`). **Refactorización:** una única sentencia
`UPDATE … WHERE wa_message_id = ANY(:ids)` con `RETURNING`. **Esfuerzo: M.**

---

## Frontend

### F0. Lo que está bien (para no romperlo al refactorizar)

Antes de los hallazgos, tres cosas que el frontend hace claramente mejor que el backend
y que conviene preservar:

- **Sin `any` explícito.** `grep -c "as any|: any"` sobre `frontend/src` da **0**. Los
  `as` que existen son casi todos alias de import (`Settings as SettingsIcon`); las
  aserciones de tipo reales son ~10 en todo el proyecto.
- **Validación de datos externos en el borde.** `parseChatSocketEvent`
  (`frontend/src/hooks/useChats.ts:167-278`) valida campo a campo cada evento del
  WebSocket con *type guards* en vez de castear. Es el patrón correcto.
- **Un único helper de errores de red** (`frontend/src/utils/errors.ts`), importado
  por más de 20 componentes.

### F1. Componentes y hooks con demasiadas responsabilidades

#### [ALTO] F1.1 — `MainLayout` re-implementa el enrutado que React Router ya resolvió

**Qué está mal.** `frontend/src/App.tsx:585-598` declara 8 rutas y **todas** apuntan al
mismo `<MainLayout />`. Dentro, `MainLayout` (444 líneas, `:94-537`) vuelve a derivar
la vista leyendo `location.pathname` a mano:

```ts
const isKanban = location.pathname === '/kanban'
const isTasks = location.pathname === '/tasks'
… (6 banderas, App.tsx:101-106)
```

y las resuelve con una cadena de 7 ternarios anidados (`:390-486`). El control de rol
de admin está **duplicado**: en las rutas (`:592-595`,
`me.role === 'admin' ? <MainLayout/> : <Navigate to="/"/>`) y otra vez en los ternarios
(`:402`, `:404`, `:406`, `isTemplates && me?.role === 'admin' ? …`).

**Por qué importa.** Tres consecuencias medibles:
1. Estando en `/dashboard` o `/templates`, `MainLayout` sigue ejecutando
   `useInfiniteChats(debouncedSearch, effectiveFilters)` (`:171`), `useChat` (`:184`),
   `useSuggestionStatus` (`:192`) y `useUnreadCount` (`:124`). Se piden y se mantienen
   en caché los chats aunque no haya nada que pintar.
2. Añadir una vista obliga a tocar cuatro sitios (la ruta, la bandera, el ternario, y
   `domain/navigation.ts`).
3. React Router no puede hacer code-splitting por ruta: el `lazy()` de las 6 páginas
   (`:47-70`) se resuelve dentro de un único `<Suspense>` compartido.

**Refactorización propuesta.** Convertir `MainLayout` en un layout real
(`<Route element={<AppShell/>}>` con `<Outlet/>`) y mover cada vista a su propia
`<Route element>`. El estado de la lista de chats (`search`, `advancedFilters`,
`chatFilter`) baja a la ruta de chats o sube a un contexto pequeño. La guarda de admin
queda en un único `<AdminRoute>`. **Esfuerzo: L.**

#### [ALTO] F1.2 — `useChatUpdates`: 248 líneas con tres responsabilidades y `catch` que traga todo

**Qué está mal.** `frontend/src/hooks/useChats.ts:292-540` hace, en un solo hook:
(a) ciclo de vida del WebSocket con reconexión, ping y watchdog (`:317-357`,
`:513-538`); (b) *parsing* y validación de 8 tipos de evento (delegado a
`parseChatSocketEvent`, bien); (c) **la política completa de invalidación de caché**
(`:359-511`), una cadena de 9 `if (payload.type === …)` — no un `switch`, así que
TypeScript no puede comprobar exhaustividad y un tipo de evento nuevo compila y no
hace nada.

Y el problema serio: el `try` empieza en `:361`, **antes** del `JSON.parse`, y el
`catch` cierra en `:508-510` con el comentario `// Ignora payloads que no sean JSON
válido`. Entre medias hay ~150 líneas de `queryClient.invalidateQueries(...)`,
`applyMessageStatuses(...)` y `navigate(...)`. Cualquier excepción en esa lógica —no
solo un JSON inválido— se descarta en silencio con un comentario que dice otra cosa.

**Refactorización propuesta.** Mover el `try/catch` a envolver únicamente
`parseChatSocketEvent(event.data)`. Extraer la política de invalidación a un módulo
puro `domain/socketInvalidation.ts` con la firma
`invalidationsFor(event: ChatSocketEvent): QueryKey[]` — testeable sin WebSocket— y
dejar el hook solo con el transporte. Convertir la cadena de `if` en `switch` con
`default: assertNever(payload)`. **Esfuerzo: M.**

#### [MEDIO] F1.3 — Componentes-página de 800 líneas con toda la lógica inline

`frontend/src/components/TemplatesPage.tsx` (838 líneas) contiene: 7 `useState`,
la validación de formulario `validateTemplateForm` (`:83-202`, **120 líneas**),
la validación de adjuntos (`:203-215`), `fileToBase64` (`:220`), y el JSX de la lista,
el diálogo de creación/edición y el editor interactivo.
`frontend/src/components/VisualFlowBuilder.tsx` (789 líneas) declara **18 `useState`**
(`:198-227`) en un solo componente, mezclando estado del documento (nodos, aristas,
nombre) con estado de UI (`simulationOpen`, `versionsOpen`, `leadSearch`, `searching`).

**Refactorización propuesta.** Para `TemplatesPage`: extraer `useTemplateForm()` (estado
+ validación) y `TemplateFormDialog` como componente. Para `VisualFlowBuilder`: un
`useReducer` para el documento del flujo (nodos/aristas/nombre, que cambian juntos) y
dejar `useState` solo para lo efímero; los diálogos de simulación y versiones a
componentes propios. **Esfuerzo: M** cada uno.

### F2. Duplicación entre componentes

#### [ALTO] F2.1 — El editor de las 12 acciones de automatización está escrito dos veces

**Qué está mal.** `frontend/src/components/AutomationsPage.tsx` y
`frontend/src/components/VisualFlowBuilder.tsx` implementan **cada uno** un editor
completo para los mismos 12 tipos de acción:

- `defaultAction(type)` es **idéntico literal**: `AutomationsPage.tsx:52` y
  `VisualFlowBuilder.tsx:64` contienen exactamente
  `{ type, title: 'Dar seguimiento a {{nombre}}', description: '', task_type: TaskTypeValue.FollowUp, priority: TaskPriorityValue.Normal, due_minutes: 60, remind_minutes_before: 15, assigned_user_id: null }`.
- El formulario de `create_task`: `AutomationsPage.tsx:407` (una sola línea de 3267
  caracteres) frente a `VisualFlowBuilder.tsx:765` (`ActionEditor`, una línea de 2152
  caracteres). Mismos campos, mismos límites (`max={43200}`), distinto marcado.
- La validación de cliente también: `AutomationsPage.tsx:138-139` valida título,
  `due_minutes` y `remind_minutes_before`; el builder visual delega en el servidor.

**Por qué importa.** Hay ahora **tres** definiciones de las reglas de cada acción
(backend `validate_automation_rule`, `AutomationsPage`, `VisualFlowBuilder`). Añadir
un campo a una acción exige tocar las tres y nada avisa si se olvida una; ya hoy el
builder visual no valida `remind_minutes_before < due_minutes` y el otro sí.

**Refactorización propuesta.** Un único `components/automation/ActionEditor.tsx`
parametrizado por *layout* (compacto para el panel del builder, expandido para la
página), y `defaultAction` movido a `frontend/src/domain/automationCatalog.ts` —donde
ya vive el resto del catálogo. **Esfuerzo: M.**

#### [MEDIO] F2.2 — Formato de fecha/hora sin criterio: `es-PE`, `es-AR` y locale del navegador conviven

**Qué está mal.** No hay ningún módulo de formato de fechas. Cada componente llama a
`toLocaleString` con su propia configuración:

- `es-PE`: `AutomationsPage.tsx:105`, `DashboardPage.tsx:33,34,160,161,169,170,204`,
  `LeadActivityPanel.tsx:118`, `LeadTaskCard.tsx:85`, `ScheduledMessageCard.tsx:60`,
  `TasksPage.tsx:92`, `VisualFlowBuilder.tsx:573`.
- `es-AR`: `ChatItem.tsx:19`, `LeadInfo.tsx:28`, `LeadInfo.tsx:37`,
  `utils/message.ts:331`, `utils/message.ts:341`.
- Locale del navegador: `CustomerServiceWindowStatus.tsx:27`,
  `NotificationCenter.tsx:26`, `utils/templates.ts:13`.

Además, `ChatItem.tsx:19` es copia literal de `formatMessageTime`
(`frontend/src/utils/message.ts:328-332`), que ya está exportada.

**Por qué importa.** La zona horaria de negocio del backend es `America/Lima`
(`backend/services/automation_rules.py:20`), así que `es-AR` es directamente el locale
equivocado; y con el locale del navegador un usuario con Windows en inglés ve
`8/5/2026` junto a `05/08/2026` en la misma pantalla.

**Refactorización propuesta.** `frontend/src/utils/datetime.ts` con `APP_LOCALE`,
`formatDate`, `formatDateTime`, `formatTime` y `formatDayLabel`; sustituir las 20
llamadas. `ChatItem.tsx:19` pasa a importar `formatMessageTime`. **Esfuerzo: S.**

#### [MEDIO] F2.3 — `fileToBase64` copiado y límites de subida triplicados

**Qué está mal.** La misma promesa sobre `FileReader.readAsDataURL` está escrita en
`frontend/src/components/TemplatesPage.tsx:220-228` y
`frontend/src/components/MediaLibraryPage.tsx:23-31` (idénticas), y otra vez inline en
`frontend/src/components/ChatComposer.tsx:26-29` y
`frontend/src/components/EmojiStickerPanel.tsx:134-139`.

El límite de 25 MB aparece en `MediaLibraryPage.tsx:13` (`MAX_BYTES`),
`TemplatesPage.tsx:72` (`MAX_ATTACHMENT_BYTES`) y `backend/routers/media.py:39`
(`MAX_BYTES`), sin ninguna relación entre ellos.

**Refactorización propuesta.** `frontend/src/utils/files.ts` con `fileToBase64` y
`validateUpload(file)`; el límite se sirve desde el backend (por ejemplo en el mismo
`/api/chats/phone-config` que ya existe para este tipo de configuración de cliente) o,
como mínimo, se centraliza en una constante única del frontend. **Esfuerzo: S.**

#### [MEDIO] F2.4 — `useSuggestions` reimplementa `extractErrorMessage`

`frontend/src/hooks/useSuggestions.ts:21-25` desenvuelve `err.response.data.detail`
a mano cuando `frontend/src/utils/errors.ts:4-5` ya hace exactamente eso y es lo que
usan los otros 20 consumidores. **Esfuerzo: S.**

#### [MEDIO] F2.5 — Las variables `{{…}}` y su lista blanca, terceras copias del backend

Ver **B2.1**: `frontend/src/utils/templates.ts:13` reimplementa la sustitución con un
formato de fecha distinto, y `frontend/src/components/TemplatesPage.tsx:77`
(`ALLOWED_INTERNAL_VARIABLES`) duplica `backend/routers/templates.py:21` y
`backend/services/automation_rules.py:23`. **Esfuerzo: S.**

### F3. Manejo de errores y estados

#### [ALTO] F3.1 — `catch` vacío que oculta errores de lógica (ver F1.2)

`frontend/src/hooks/useChats.ts:508-510`. Es el único `catch` mudo relevante del
frontend, pero cubre el camino por el que pasa **todo** el tiempo real de la
aplicación. **Esfuerzo: S** (mover el `try` a rodear solo el parseo).

#### [MEDIO] F3.2 — Cuatro `eslint-disable react-hooks/exhaustive-deps`

`frontend/src/App.tsx:225` y `:288`, `frontend/src/components/ChatList.tsx:271`,
`frontend/src/hooks/useThreadScroll.ts:258`. Los cuatro están comentados con su motivo
—lo cual es correcto— pero tres de ellos existen porque el efecto depende de un objeto
o callback que se recrea en cada render (por ejemplo `selectedChat?.unread_count` en
`App.tsx:226`). Estabilizar la dependencia con `useCallback`/`useRef` elimina la
supresión y con ella el riesgo de que un día la dependencia realmente falte.
**Esfuerzo: S** cada uno.

### F4. Tipado (`any`, `as`, casts)

#### [ALTO] F4.1 — TypeScript **no está en modo `strict`**

**Qué está mal.** `frontend/tsconfig.app.json` no declara `"strict"`, ni
`"strictNullChecks"`, ni `"noImplicitAny"` (solo `noUnusedLocals`,
`noUnusedParameters`, `erasableSyntaxOnly`, `noFallthroughCasesInSwitch`).
`frontend/tsconfig.json` es un fichero de referencias sin `compilerOptions`.
`grep -rn "strict" frontend/tsconfig*.json` no devuelve nada.

**Por qué importa.** Invalida gran parte del mérito de "cero `any`": sin
`noImplicitAny`, un parámetro sin anotar **es** `any` aunque no aparezca escrito; y sin
`strictNullChecks`, los ~200 tipos `| null` de `frontend/src/types/index.ts` (693
líneas) no obligan a comprobar nada — `chat.phone.replace(...)` compila con `phone`
declarado `string | null`. El código está escrito *como si* fuera estricto (los type
guards de `parseChatSocketEvent` lo demuestran), así que activar `strict` debería
producir sorprendentemente pocos errores, y cada uno de ellos será real.

**Refactorización propuesta.** Activar `"strict": true` en `tsconfig.app.json`, medir
los errores y corregirlos por fichero. Como el `build` de CI ya ejecuta `tsc -b`
(`.github/workflows/ci-cd.yml:24-26`), la protección es inmediata sin tocar el pipeline.
**Esfuerzo: M** (depende del recuento; probablemente bajo).

#### [MEDIO] F4.2 — El linter solo tiene dos reglas activas

`frontend/.oxlintrc.json` habilita únicamente `react/rules-of-hooks` (error) y
`react/only-export-components` (warn). No hay `no-explicit-any`,
`react-hooks/exhaustive-deps` (las supresiones de F3.2 son, por tanto, decorativas),
`no-floating-promises` ni `consistent-type-imports`. `npm run lint` en CI pasa casi
siempre por construcción. **Refactorización:** partir de la configuración recomendada
de oxlint para `react` + `typescript` y silenciar puntualmente lo que moleste.
**Esfuerzo: S.**

#### [MEDIO] F4.3 — Aserciones sobre datos externos sin validar

Las pocas aserciones que existen están, precisamente, donde más duelen:

- `frontend/src/components/StageChangeCard.tsx:42`:
  `const trigger = (activity.metadata?.trigger_message ?? null) as TriggerMessage | null`
  — `metadata` es JSON libre de la base de datos; si el backend cambia la forma, el
  componente rompe en tiempo de ejecución.
- `frontend/src/components/StageChangeCard.tsx:17`: `LEAD_STAGE_META[stage as LeadStage]`
  — una etapa desconocida devuelve `undefined` y revienta al desreferenciar.
- `frontend/src/components/ChatList.tsx:437` y `:454`:
  `event.target.value as ChatFilters['lastSender']` sobre el valor de un `<select>`.
- `frontend/src/components/flow/FlowCanvas.tsx:694`: `raw as AutomationFlowNodeType`
  sobre el `dataTransfer` de un drop.
- `frontend/src/hooks/useChats.ts:547`: `encodeURIComponent(chatId as string)` dentro
  de una query con `enabled: !!chatId` — funciona, pero el cast oculta la invariante.

**Refactorización propuesta.** Reutilizar el patrón que el propio proyecto ya usa bien
(`isMessageType`, `isMessageStatus` en `useChats.ts:39-45`, `isTaskType` en
`domain/automationCatalog.ts`): type guards en lugar de `as`. **Esfuerzo: S.**

### F5. Funciones largas y anidamiento

#### [ALTO] F5.1 — 130 líneas de más de 300 caracteres; la peor tiene 4167

**Qué está mal.** Medición sobre `frontend/src` (excluidos tests):

| Fichero | Líneas > 300 chars | Peor línea |
|---|---|---|
| `frontend/src/components/AutomationsPage.tsx` | 31 | `:404` — **4167 caracteres** |
| `frontend/src/components/VisualFlowBuilder.tsx` | 28 | `:556` — 3407 caracteres |
| `frontend/src/components/TemplatesPage.tsx` | 22 | `:633` — 1941 caracteres |
| `frontend/src/components/TemplateSendDialog.tsx` | 13 | `:323` — 815 caracteres |
| `frontend/src/components/NotificationCenter.tsx` | 7 | — |

`VisualFlowBuilder.tsx:556` es **un diálogo modal completo** (búsqueda de lead,
resultados, botón de simular y render de la ruta resultante) en una sola línea física.
`AutomationsPage.tsx:404-411` son seis formularios de acción, uno por línea.

**Por qué importa.** No es cosmético: un `git diff` sobre esas líneas es ilegible, una
revisión de código no puede señalar un cambio concreto, y un conflicto de merge en
`AutomationsPage.tsx:404` obliga a resolver 4167 caracteres a mano. También impide que
cualquier herramienta de cobertura o de análisis dé información por línea útil.

**Refactorización propuesta.** Adoptar un formateador (Prettier o `oxlint --fix` con
`max-len`) con ancho 120 y aplicarlo en un commit aislado de "solo formato" para que
no contamine el historial; a continuación extraer los modales a componentes propios
(`FlowSimulationDialog`, `FlowVersionsDialog`, `ActionEditor` — ver F2.1).
**Esfuerzo: S** el formateo, **M** la extracción.

#### [MEDIO] F5.2 — `validateTemplateForm`: 120 líneas de validación en el cliente sin equivalencia garantizada

`frontend/src/components/TemplatesPage.tsx:83-202` valida títulos, pies, botones,
secciones, filas, URLs y teléfonos con los mismos límites que
`backend/routers/templates.py:81-190`. Es la tercera copia del mismo contrato
(ver B2.2). **Refactorización:** exponer los límites desde el backend
(`GET /api/templates/limits`) o generarlos, y dejar en el cliente solo la comprobación
—no la definición— de las reglas. **Esfuerzo: M.**

#### [BAJO] F5.3 — `useThreadScroll`: 341 líneas con 5 `useState` y 7 `useEffect`

`frontend/src/hooks/useThreadScroll.ts` es el hook con más efectos del proyecto.
Tiene test propio (`useThreadScroll.test.tsx`, 255 líneas), lo que mitiga el riesgo,
pero la interacción entre siete efectos sobre el mismo `ref` de scroll es difícil de
razonar. **Refactorización:** separar "restaurar posición al cargar página anterior"
de "seguir al final si el usuario está abajo" en dos hooks. **Esfuerzo: M.**

### F6. Gobernanza y tooling (transversal)

#### [ALTO] F6.1 — El backend no tiene linter ni verificador de tipos

**Qué está mal.** `backend/requirements-dev.txt` contiene únicamente `pytest` y
`pytest-asyncio`. No existe `backend/pyproject.toml`, ni configuración de `ruff`,
`flake8`, `black` o `mypy`. El job `backend-checks` de
`.github/workflows/ci-cd.yml:26-52` ejecuta `python -m compileall -q .`, un import de
humo y `pytest`.

**Por qué importa.** `compileall` solo comprueba que el fichero parsea. Explica
directamente varios hallazgos anteriores: el argumento `deps` olvidado (B3.2), el
parámetro `deps` no utilizado en `_resolve_flow_definition` (B3.1), la sangría
engañosa (B6.2), los logs bilingües (B4.3) y los 251 `dict` sin parametrizar (B5.1).
Todo eso lo señala `ruff` con la configuración por defecto.

**Refactorización propuesta.** Añadir `ruff` (lint + format) y `mypy` en modo no
estricto a `requirements-dev.txt` y al job de CI, empezando con las reglas `E,F,W,B,SIM`
y una lista de exclusiones para no bloquear. **Esfuerzo: M** (S para instalarlo, M para
dejar el repositorio limpio).

---

## Top 10 acciones priorizadas

| # | Acción | Hallazgo | Impacto | Esfuerzo |
|---|---|---|---|---|
| 1 | Añadir `ruff` + `mypy` al backend y `"strict": true` al `tsconfig.app.json`, ambos en CI | F6.1, F4.1 | Alto — es la red que impide que reaparezcan la mitad de los hallazgos | M |
| 2 | Corregir `_notify_execution_failure(rule, execution, str(exc))` para que reciba `deps` | B3.2 | Alto — bug real en la ruta de error del motor | S |
| 3 | Unificar el renderizado de `{{variables}}`: `routers/chats.py` importa `render_variables` de `automation_rules` | B2.1, F2.5 | Alto — corrige `{{fecha_actual}}` desfasado un día por la noche | S |
| 4 | Sustituir los `except Exception: raise HTTPException(500, str(e))` por un handler global con `logger.exception` | B4.1 | Alto — deja de filtrar internals y empieza a registrar los 500 | S |
| 5 | Mover el `try/catch` de `useChatUpdates` a rodear solo `parseChatSocketEvent` y extraer la política de invalidación | F1.2, F3.1 | Alto — hoy cualquier error del tiempo real desaparece en silencio | M |
| 6 | Extraer un único `ActionEditor` + `defaultAction` compartido entre `AutomationsPage` y `VisualFlowBuilder` | F2.1 | Alto — elimina la tercera definición de las 12 acciones | M |
| 7 | Unificar la validación de plantillas interactivas en `services/interactive_templates.py` (backend) y consumir sus límites desde el cliente | B2.2, F5.2 | Alto — un solo contrato en vez de tres | M |
| 8 | Partir `automation_service.py` en el paquete `services/automations/` (repository / validation / flows / actions / engine / scheduler) | B1.1, B1.4, B1.5, B6.1 | Alto — desbloquea todo lo demás sobre automatizaciones | L |
| 9 | Partir `db_service.py` en `repositories/` por agregado y sacar `fetch_chats` a un `ChatFilters` tipado | B1.2, B1.3 | Alto — reduce el acoplamiento aferente del backend | L |
| 10 | Formatear el frontend (ancho 120) en un commit aislado y crear `utils/datetime.ts` + `utils/files.ts` | F5.1, F2.2, F2.3 | Medio — hace revisable el 15 % del frontend que hoy no lo es | S |

**Orden sugerido de ejecución:** 1 → 2, 3, 4 (arreglos de una línea, protegidos ya por
el paso 1) → 10 (formateo, antes de tocar esos ficheros) → 5, 6, 7 → 8, 9.
