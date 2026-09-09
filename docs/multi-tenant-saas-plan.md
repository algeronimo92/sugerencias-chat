# Plan de arquitectura: pasar el CRM a SaaS multi-tenant

> Estado: propuesta para revisión. No se ha tocado código de producto todavía.
> Modelo elegido: **tenant = organización**. Una organización tiene UN número
> de WhatsApp y VARIOS usuarios que comparten los mismos leads y mensajes.
>
> Revisión 2026-09-09: se actualiza sobre la versión original (2026-07-21)
> para reflejar dos cambios de fondo verificados en el código y en
> `rag.json`: (1) n8n **ya no escribe directo en la base** — todo pasa por
> `/api/webhooks/*`, lo cual elimina el riesgo que este plan marcaba como el
> más grave; y (2) hay una migración en curso de Evolution API a **Meta Cloud
> API** para el envío y las plantillas oficiales (`backend/services/meta_service.py`),
> con intención de reemplazar Evolution también en la recepción y quedarse con
> n8n como orquestador/normalizador. Esta revisión también incorpora las tres
> costuras de arquitectura identificadas en
> `docs/analisis/03-arquitectura-y-flujo-de-eventos.md` (§A.7), porque son
> prerrequisito técnico del scoping por organización, no un proyecto aparte.

## 1. Objetivo

Que cada organización se registre, **conecte su propio número de WhatsApp**
y vea **solo sus propios leads y mensajes**, mientras todas las organizaciones
reciben en paralelo. El mecanismo de conexión ya no está cerrado a "escanear
un QR": con Meta Cloud API como proveedor objetivo, es más probable que sea
un flujo de **Embedded Signup** de Meta (ver §3.7). El QR sigue vigente hoy
porque Evolution todavía es el canal de entrada real.

Aclaración que sigue vigente: la separación entre organizaciones es un
problema de *aislamiento de datos*, no de qué proveedor de WhatsApp esté
detrás. Cambiar de Evolution a Meta Cloud API no resuelve el multi-tenant por
sí solo; solo cambia cuál es el proveedor cuya identidad hay que scopear.

## 2. Punto de partida

Qué es cierto hoy en el código (verificado, no lo que se documentó en julio):

- **Datos en un pool único.** `leads` (PK interna `UUID`, con `remote_jid`
  legacy) y `wsp_messages` (`chat_id`) no tienen dueño todavía. Ver
  [db/models.py](../backend/db/models.py).
- **Ya resuelto: n8n dejó de escribir en la base.** El riesgo #1 de la versión
  anterior de este plan ("n8n hace INSERT/UPDATE directo sobre tablas de
  negocio") ya no existe. Verificado en `rag.json`: no queda ningún nodo
  `n8n-nodes-base.postgres` en el workflow; cada escritura pasa por un
  endpoint HTTP de `backend/routers/webhooks.py` (`ensure-lead`, `lead-raw`,
  `save-inbound-message`, `messages`, `reaction`, `message-edited-secret`,
  `outgoing`, `poll-results`, `message-status`, `meta-media`, etc.). Varios
  docstrings del propio backend lo dejan explícito, por ejemplo
  `ensure_lead_webhook`: *"Reemplaza al nodo Postgres `create lead`"*. Esto es
  una base mucho mejor de lo que asumía la versión original del plan: **la
  única superficie de escritura de datos de negocio ya es el backend**, así
  que el scoping por organización se puede resolver ahí, sin coordinar
  cambios de esquema con n8n.
- **Migración de proveedor en curso, no completa.** `meta_service.py` ya es
  el único camino para enviar mensajes y para el ciclo de vida de plantillas
  oficiales (`message_outbox.py` y `routers/templates.py` no importan nada de
  `evolution_service`). La recepción todavía depende de Evolution → n8n para
  el grueso del flujo, pero ya hay una costura empezada del lado de Meta:
  `/api/webhooks/meta-media` descarga multimedia entrante vía
  `meta_service.download_media` porque *"la descarga necesita el token de
  Meta, que solo está en las settings del backend"* (comentario del propio
  código). Confirmado con el usuario: la intención es sacar Evolution por
  completo y quedarse con n8n como orquestador (IA, normalización de
  payloads, análisis de imagen/audio), no como sistema de mensajería.
- **`rag.json` ya tiene una noción de "instance"**, pero hoy es un valor
  hardcodeado (`"instance": "dermicapro-business"`, líneas ~5145-5189) usado
  únicamente para decidir si el backend de destino es un túnel de desarrollo
  o producción — **no** para identificar organización. Es, sin embargo, el
  campo natural para convertir en la clave de ruteo instancia/número → org
  cuando haya más de una.
- **Config global.** Evolution, n8n, ElevenLabs y (ahora) Meta viven en
  `app_settings`, una fila por clave, global. Ver
  [settings_service.py](../backend/services/settings_service.py).
- **Auth existe pero sin tenant.** `users` con roles admin/vendedor
  ([auth_service](../backend/services/auth_service.py)); todos ven los mismos
  datos. El primer admin se siembra con `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
- **Tiempo real global.** `/ws/chats` hace `manager.broadcast(...)` a
  **todos** los clientes conectados
  ([ws_manager](../backend/services/ws_manager.py)), desde ~15 call sites
  distintos sin un contrato compartido.
- **Workers globales.** `chat_watcher`, `automation_service`,
  `task_reminder`, `message_outbox` y `scheduled_message_service` recorren
  toda la base sin noción de organización. `chat_watcher` en particular no es
  parametrizable tal cual está: calcula una firma y "el último mensaje" sobre
  la tabla entera.
- **Sin capa de acceso a datos donde inyectar el scope.** `db_service.py`
  (~3000 líneas) más otros 8 servicios abren su propia sesión SQLAlchemy y
  arman `select()` a mano. Es el bloqueador técnico real del plan: sin esto,
  agregar `organization_id` obliga a auditar todo el backend en vez de un
  punto de entrada acotado.
- **QR de Evolution: vigente pero con fecha de vencimiento.** El flujo ya
  construido ([whatsapp.py](../backend/routers/whatsapp.py),
  [evolution_service.py](../backend/services/evolution_service.py),
  `WhatsappPanel.tsx`) sigue funcionando hoy, pero es específico de
  Baileys/Evolution. Si Evolution se retira, este flujo se retira con él y el
  onboarding de organizaciones nuevas necesita un mecanismo distinto (§3.7).

## 3. Arquitectura objetivo

### 3.1 Modelo de datos
- Nueva tabla `organizations` (id, name, status, plan, created_at, …).
- `users.organization_id` FK. Los roles (admin/vendedor) pasan a ser
  **dentro de** la organización.
- `organization_id` en todas las tablas de negocio: `leads`, `wsp_messages`,
  `lead_tasks`, `internal_notes`, `tags` (+ mapeos), `message_templates`,
  `automation_rules`, `automation_executions`, `notifications`,
  `lead_activity`, `message_outbox`, `media_library`, `scheduled_messages`,
  `app_settings` (pasa a `organization_settings`).

### 3.2 Identidad interna de `leads`
Ya resuelto en su primera parte: `leads.id` es `UUID` y las FK internas
apuntan a ella; los JID externos viven en `whatsapp_identities.lead_id`.

Falta: `organization_id` en la unicidad de los alias — `(organization_id,
instance, jid)` en vez de `(instance, jid)` — para que dos organizaciones
registren el mismo contacto sin colisión.

**Punto nuevo a verificar antes de diseñar el scoping de identidad**: buena
parte de la complejidad actual (`whatsapp_identity_service`, `lead_merge`)
existe por cómo Baileys/Evolution expone un LID distinto del JID telefónico.
No hay confirmación en este repo de si Meta Cloud API tiene un problema
equivalente (Meta identifica los chats por `wa_id`, generalmente el número en
formato E.164) o si ese problema se reduce al retirar Evolution. **No asumir
que `whatsapp_identity_service` deja de hacer falta sin revisar primero un
payload real de webhook de Meta.**

### 3.3 Aislamiento (defensa en profundidad)
Dos capas, de menor a mayor garantía:

1. **Scoping obligatorio en la app**, implementado como un `TenantContext`
   resuelto por un `Depends` de FastAPI a partir de la sesión/JWT, propagado
   explícitamente a los servicios de caso de uso, y **exigido por la capa de
   repositorios** (§3.8) — no por convención en cada función suelta. Cubierto
   con tests que fallan si un endpoint devuelve datos de otra organización.
2. **Row-Level Security de PostgreSQL (hardening)**, con políticas por
   `current_setting('app.current_org')`. Va después del scoping de
   aplicación, como red de seguridad si un query se escapa.

### 3.4 Proveedor de WhatsApp por organización

Con la migración a Meta Cloud API confirmada como destino, este punto cambia
de forma respecto al plan original:

- **Objetivo**: cada organización tiene un `phone_number_id` de WhatsApp
  Business Platform (posiblemente bajo un único Business Manager "tech
  provider", posiblemente uno por cliente — a decidir en §3.7). Se guarda por
  organización: `phone_number_id`, token de acceso (o referencia al System
  User), y estado de conexión. **No hay instancia de servidor por
  organización** — a diferencia de Evolution, sumar una org no consume un
  proceso ni una sesión de Baileys.
- **Evolution como puente, no como destino final.** Mientras convivan
  clientes ya conectados por QR, el modelo de "una instancia por org" del
  plan original sigue siendo válido *para esos clientes legacy*, con el
  riesgo ya señalado (recursos de servidor por instancia). No conviene
  invertir en generalizar ese modelo si el rumbo es abandonarlo.
- **`EvolutionClient`/`MetaClient` instanciables** (§3.8.3) son el
  prerrequisito técnico común a ambos casos: sin esto, no hay forma de que
  `message_outbox` sepa con qué credencial/proveedor enviar según la
  organización del job.

### 3.5 Ruteo en n8n

Actualizado: n8n **no** necesita escribir `organization_id` en ningún INSERT
propio, porque ya no hace ningún INSERT — pero sí necesita **mandar el dato
que permite resolverlo** en cada llamada a `/api/webhooks/*`, y hoy no lo
hace (el único campo parecido, `"instance"`, está hardcodeado a
`"dermicapro-business"` para un propósito distinto, ruteo de entorno).

Camino recomendado, en orden de preferencia:

1. Si el mensaje llega originado en Meta Cloud API, el payload de Meta ya
   trae `phone_number_id` en cada webhook (`entry[].changes[].value.metadata.phone_number_id`).
   n8n lo reenvía tal cual en el body a `/api/webhooks/*`; el backend resuelve
   `phone_number_id → organization_id` con una tabla de mapeo propia. n8n no
   necesita saber nada de organizaciones.
2. Mientras Evolution siga viva, el nombre de instancia de Evolution cumple
   el mismo rol (`instance → organization_id`), y es exactamente el campo
   `"instance"` que `rag.json` ya transporta hoy, solo que hay que dejar de
   hardcodearlo y generalizar el mapeo en el backend en vez de en n8n.

Esto reduce el riesgo original de "coordinar el esquema de tablas externas
con n8n" a "coordinar qué campo de identificación de proveedor viaja en el
body" — mucho más chico, y no requiere que n8n conozca el modelo de datos de
la app.

### 3.6 Tiempo real y workers
- **WebSocket por organización.** Deja de ser un broadcast global: se agrupa
  por org y se emite solo a esa organización.
- **Workers por organización.** Los watchers leen `organization_id` de la
  fila que reclaman (la mayoría ya usa `FOR UPDATE SKIP LOCKED` fila por
  fila, así que esto es barato) y lo propagan a lo que emiten. La excepción
  es `chat_watcher`, que no es parametrizable tal cual y hay que reescribirlo
  (calcula una firma y "el último mensaje" sobre toda la tabla, no por chat
  ni por org).

Esta sección se implementa en la práctica como el **event bus interno**
(§3.8.2): en vez de tocar los ~15 call sites de `manager.broadcast(...)` uno
por uno para agregarles un filtro de org, se centraliza la emisión en un solo
punto que ya conoce el `TenantContext`.

### 3.7 Onboarding / signup

Punto abierto, y más abierto que en la versión original del plan porque ya no
se puede asumir QR:

- **Si el proveedor final es Meta Cloud API**, el onboarding estándar para
  una plataforma que conecta números de terceros es **Embedded Signup**
  (OAuth de Meta for Business + verificación de negocio + tokens de System
  User, típicamente bajo el rol de "Tech Provider" o similar en Meta). Es un
  flujo bastante distinto al QR: depende de aprobación/verificación de Meta,
  no solo de código propio. **Esto es una dependencia de producto y de
  plazos de Meta, no solo de arquitectura — investigar y timeboxear aparte,
  antes de comprometer fechas del pivot.**
- **Mientras tanto**, el flujo QR ya construido se puede seguir usando para
  clientes que se conecten vía Evolution, y convive con Embedded Signup para
  los que se conecten vía Meta — dos caminos de onboarding en paralelo
  durante la transición, no una decisión de "todo o nada".
- El alta crea `organization` + primer usuario admin de esa org. Reemplaza
  el seed único `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
- Billing, planes y límites: etapa final, no bloquean el resto.

### 3.8 Costuras internas de arquitectura (prerrequisito técnico)

Tomado de `docs/analisis/03-arquitectura-y-flujo-de-eventos.md` §A.7: no son
un proyecto aparte del pivot SaaS, son lo que hace que el pivot sea acotado
en vez de "tocar todo el backend". Sin esto, la Etapa 1 de la sección 4 no
tiene dónde apoyarse.

1. **Repositorios + `TenantContext`.** `db_service.py` y los ~8 servicios que
   abren sesión propia (`message_outbox`, `scheduled_message_service`,
   `automation_service`, `notification_service`, `productivity_service`,
   `internal_notes_service`, `media_library_service`, `settings_service`) se
   parten por agregado: `repositories/{chats,leads,tags,users,automations,...}.py`.
   Cada método de repositorio exige `organization_id` como parámetro — no
   opcional, no con default. Es mecánico y con alto volumen, pero de bajo
   riesgo porque los tests actuales ya cubren el comportamiento.
2. **Event bus interno.** Reemplaza los ~15 `manager.broadcast(...)`
   dispersos por `bus.publish(ChatUpdated(org_id=..., chat_id=..., reason=...))`.
   El transporte (in-memory hoy, Redis pub/sub o `LISTEN/NOTIFY` mañana) queda
   detrás de una interfaz. Resuelve a la vez: el filtrado por organización
   (§3.6), el problema ya existente de que blue-green corre dos backends que
   no se enteran entre sí, y el contrato implícito de `chats_updated` (~15
   variantes de `reason` como string libre, consumidas por un switch gigante
   en el frontend).
3. **Clientes de proveedor instanciables.** `evolution_service.py` y
   `meta_service.py` pasan de módulos con config global (`_http_client`,
   `_config()` resolviendo una única instancia) a clases instanciadas por
   organización: `MetaClient(phone_number_id, token)`,
   `EvolutionClient(url, api_key, instance)`. `message_outbox` construye el
   cliente correcto a partir del `organization_id` del job. Nota: la
   migración a Meta ya tuvo la oportunidad de introducir este patrón y no lo
   hizo — `meta_service.py` repite el mismo molde de singleton que
   `evolution_service.py`. Conviene resolverlo ahora, antes de que el resto
   del backend dependa aún más de la forma actual.

## 4. Plan por etapas

Fusiona las etapas del plan original con las costuras de §3.8, en el orden
que minimiza riesgo (cada etapa es desplegable sola sin cambiar el
comportamiento observable, salvo donde se indica).

| # | Etapa | Alcance | Resultado | Riesgo |
|---|---|---|---|---|
| 0a | **Event bus + realtime fuera de proceso** | `ws_manager`, los ~15 call sites de broadcast, `_wake`/`_wakeup` in-process | Arregla algo que **ya está roto hoy** (blue-green no propaga broadcasts entre colores). Deja la costura donde después entra el filtro por org. No requiere tocar el esquema. | Bajo-Medio |
| 0b | **Repositorios por agregado** | `db_service.py` → `repositories/{chats,leads,tags,users,automations}.py`; los 8 servicios con sesión propia | Sin esto, el scoping de la Etapa 2 no tiene dónde apoyarse. Cubierto por los tests existentes. | Bajo (alto volumen) |
| 0c | **Clientes de proveedor instanciables** | `evolution_service.py`, `meta_service.py`, `message_outbox`, `automation_deps`, `whatsapp.py` | Prerrequisito de "credencial por organización" tanto para Meta como para Evolution legacy. Se puede hacer ya con un único cliente global construido desde settings, sin esperar a tener organizaciones reales. | Bajo |
| 1 | **Fundaciones multi-tenant** | Tabla `organizations`; `users.organization_id`; sesión/JWT con `org_id`; "organización por defecto" + backfill de todo lo existente | Sin cambio de comportamiento: sigue habiendo una sola org. `TenantContext` ya tiene a quién dárselo (repositorios de la 0b). | Bajo |
| 2 | **Scoping de datos** | `organization_id` en todas las tablas de negocio (backfill) + cada repositorio exige org_id + tests de aislamiento | Aislamiento real a nivel app. Es el grueso del trabajo. Con 0a-0c-1 hechas, la superficie de auditoría baja de "todo el backend" a "los repositorios". | **Alto** |
| 2b | **Unicidad de `wsp_messages.wa_message_id` a `(organization_id, wa_message_id)`** | migración | Sin esto, un mensaje de la organización B puede rechazarse como "duplicado" del de la organización A (el índice único hoy es global). Debe ir en la misma ventana que la Etapa 2. | Alto |
| 3 | **Proveedor por organización** | `phone_number_id`/instancia + credencial por org; para Meta: tabla de mapeo `phone_number_id → organization_id`; para Evolution legacy: mapeo `instance → organization_id` (reemplaza el `"dermicapro-business"` hardcodeado de `rag.json`) | Cada organización manda/recibe por su propio número. | Medio |
| 4 | **Onboarding** | Embedded Signup de Meta (o QR para clientes legacy de Evolution, en paralelo) | Alta de organización autoservicio. Depende de investigación/aprobación de Meta — no bloquea las etapas anteriores. | Medio-Alto (dependencia externa) |
| 5 | **Workers con contexto de org** | Los 5 watchers leen `organization_id` de la fila reclamada; reescribir `chat_watcher` (no es parametrizable, hay que rehacerlo) | El outbox y `scheduled_messages` ya reclaman fila por fila, así que solo necesitan propagar el dato. | Medio |
| 6 | **`app_settings` por organización + RLS como red de seguridad** | `app_settings` → `organization_settings`; políticas RLS | Config de proveedor y de IA por org. RLS al final, como hardening. | Medio-Alto |
| 7 | **Signup + billing** | Planes, límites, facturación | Producto SaaS vendible. | Medio |

## 5. Riesgos y decisiones abiertas

- ~~Fuga entre tenants por escritura directa de n8n~~ — **resuelto**: n8n ya
  no escribe en la base (§2). El riesgo de fuga que queda es el de siempre en
  cualquier query de la app sin filtrar por org; se mitiga con la capa de
  repositorios obligatoria (§3.8.1) + tests, y RLS como hardening.
- **Dependencia de Embedded Signup de Meta para el onboarding real.** No es
  código propio: depende de la verificación de negocio y del rol de "tech
  provider" en Meta for Developers. Investigar el proceso y los plazos antes
  de prometer fecha de lanzamiento del signup autoservicio.
- **`wsp_messages.wa_message_id` con UNIQUE global** (Etapa 2b) — si se
  migra el esquema sin corregir este índice a la vez, un mensaje de una
  organización puede perderse silenciosamente por chocar con el de otra.
- **`chat_watcher` no se parametriza, se reescribe.** Calcula una firma y "el
  último mensaje" sobre toda la tabla; no hay forma de agregarle un `WHERE
  organization_id = ...` y que siga teniendo sentido tal como está diseñado.
- **Identidad LID/JID bajo Meta Cloud API: sin verificar.** Ver §3.2. No
  asumir que se simplifica sin confirmarlo contra un payload real.
- **Superficie de la Etapa 2 sigue siendo grande** aun con repositorios: es
  la migración de esquema con backfill sobre tablas con datos reales de
  clientes. Alto riesgo por definición, se mitiga con tests de aislamiento
  específicos (un test que falla si un endpoint devuelve datos de otra
  organización), no solo con los tests funcionales existentes.
- **Evolution no desaparece de un día para el otro.** Mientras haya clientes
  conectados por QR, las Etapas 3 y 5 tienen que soportar los dos proveedores
  a la vez (Meta y Evolution), no solo Meta.

## 6. Qué NO cambia

- El patrón de settings (DB cifrada > `.env`) y la mayoría de la UI de
  leads/mensajes se conservan; lo que cambia por debajo es el *scope* de las
  consultas y quién resuelve la credencial de envío.
- El outbox transaccional (insertar el mensaje y su job de envío en la misma
  transacción) y las esperas durables de automatizaciones no cambian: son
  correctos independientemente del proveedor o del multi-tenant.
- El flujo de QR/estado de conexión de Evolution se reutiliza para los
  clientes que sigan en ese proveedor durante la transición.

## 7. Próximo paso sugerido

Arrancar por las **Etapas 0a-0c** (event bus, repositorios, clientes
instanciables). A diferencia del plan original, esto ya no es "antes de
empezar el pivot" sino la forma correcta de empezarlo: son cambios de bajo
riesgo, no requieren decidir todavía nada sobre Embedded Signup ni sobre
cuándo se apaga Evolution, y son exactamente lo que le falta a la Etapa 2
(scoping) para no volverse una auditoría de todo el backend. En paralelo,
conviene abrir la investigación de Embedded Signup de Meta (Etapa 4) cuanto
antes, porque es la única etapa de este plan con una dependencia externa que
no controlás vos.
