# Módulos de negocio

El backend es hexagonal: cada módulo es una capacidad del CRM con su lógica
adentro y sus dependencias hacia afuera detrás de puertos. Los adaptadores
de entrada son las rutas HTTP, el WebSocket, el webhook de Meta, los
callbacks de n8n, los workers y los suscriptores de eventos; los de salida,
los repositorios SQL, el canal de WhatsApp, el proveedor de IA, el
calendario, el almacenamiento y el bus de señales.

`app/composition.py` es el único lugar que conoce a la vez los puertos y sus
implementaciones: los conecta y registra los suscriptores. La API
(`app/bootstrap.py`) y el worker (`python -m app.worker`) usan el mismo
cableado y el mismo arranque (`app/runtime.py`).

## Formas de un módulo

Módulos núcleo (hexagonales):

```text
leads/
├── domain/          # Agregado, reglas, eventos y errores. Sin SQL ni HTTP.
├── application/     # Comandos (casos de uso) y puertos (Protocol).
├── infrastructure/  # Implementaciones SQL de los puertos.
├── *queries.py      # Lado de lectura: la API lo llama directo, nunca escribe.
├── api.py           # HTTP: valida, llama comandos o queries.
├── subscribers.py   # Reacciones a eventos y avisos por WebSocket.
├── public.py        # Lo que otros módulos pueden usar.
└── schemas.py       # Contratos HTTP.
```

- Un modelo de lectura grande va en su subpaquete con la misma regla: el
  dashboard de `leads` vive en `leads/dashboard/` (`*_queries.py` por bloque).
- Los puertos que se publican a otros módulos no reciben ni devuelven una
  sesión: cada operación usa `session_scope()` y, dentro de una unidad de
  trabajo, comparte su transacción.
- `leads`, `conversations` y `appointments` siguen esta forma; `ai` tiene
  `application/` (casos de uso del asistente, sobre `AiProvider`,
  `AiAccess`, `AiJobs` y `AssistantContext`) e `infrastructure/` (el
  proveedor de n8n y los adaptadores) sin dominio propio.
- `application/` llega a su propio módulo solo por puertos: de la raíz puede
  importar `errors.py`, `schemas.py` y `types.py`, nada más.
- `automations` agrega anillos de arquitectura limpia: `domain/` (reglas,
  validación, condiciones y grafo del flujo), `application/` (motor,
  acciones, bloques, simulación, gestión y disparadores, sobre
  `ExecutionStore`, `RuleStore`, `SchedulingStore` y `ReferenceChecker`) e
  `infrastructure/` (SQL y el worker con sus barridos).

Módulos CRUD planos (`catalogs`, `media`, `notifications`,
`issue_reports`, `tasks`): la API lee de `*_queries.py` y escribe por
comandos de `service.py`, que abren la unidad de trabajo y registran el
evento de lo que cambió. Un servicio que solo reenvía al repositorio es una
capa vacía y la prohíbe `test_layering`.

## Transacciones y eventos

- `app/db/uow.py`: una unidad de trabajo por caso de uso, en un
  `ContextVar`. `session_scope()` es la puerta de los repositorios: se suma a
  la unidad de trabajo activa o abre su sesión y confirma al salir. Solo
  `app/db` abre sesiones.
- `app/core/events.py`: los comandos registran eventos con `collect`; los
  handlers `transaction` corren antes del commit (auditoría, agendado) y los
  `after_commit` solo si el commit ocurrió (WebSocket, push, notificaciones).
- `publish` despacha en el acto y es solo para adaptadores sin transacción
  propia (vigilantes, workers, el motor entre pasos); dentro de una unidad
  de trabajo se niega. La lista de quién lo usa está en `test_layering`.
- `app/core/errors.py`: los casos de uso levantan `DomainError`; el handler
  de bootstrap responde `{"detail", "code"}`. `HTTPException` solo aparece en
  las rutas.

## Fronteras entre módulos

- Un módulo usa a otro por `public.py`, `schemas.py` o `ports/<operación>.py`
  (cada puerto declara `__all__` y solo reexporta a su dueño). Los enums de
  cada módulo viven en su `types.py` y se publican en `ports/types.py`.
- Solo `subscribers.py` habla con el WebSocket (`app.realtime`).
- Cada archivo de `app/db/models` pertenece a un módulo. Leer o escribir
  tablas ajenas solo se permite en la lista `FOREIGN_TABLES` de
  `tests/test_layering.py`, agrupada por motivo, que solo puede achicarse.

## Runtime

- La API corre HTTP, WebSocket y lo que depende de su proceso (recordatorios
  de tareas, métricas de colas). Con `RUN_WORKERS=true` (el default) corre
  además el trabajo de fondo; en producción va con `false` y el servicio
  `worker` lo corre aparte.
- El mantenimiento de arranque (cifrado de configuración, backfills, admin
  inicial) lo corre solo el proceso que tiene los workers, bajo un advisory
  lock: dos colores de un blue-green no lo pisan.
- Cada worker es una pasada por negocio (`app/workers/tenant_supervisor.py`):
  un ciclo por tipo que recorre los negocios activos.
- `app/db/signals.py` lleva por LISTEN/NOTIFY los avisos de tiempo real entre
  réplicas, los despertadores de las colas y la invalidación de cachés.

`tests/test_layering.py` hace cumplir todo lo anterior: pureza del dominio,
aplicación sobre puertos, HTTP sin infraestructura, lado de lectura sin
escrituras, tiempo real solo en suscriptores, sesiones solo en `app/db` y
propiedad de tablas.
