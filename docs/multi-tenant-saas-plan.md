# Plan de arquitectura: pasar el CRM a SaaS multi-tenant

> Estado: propuesta para revisión. No se ha tocado código de producto todavía.
> Modelo elegido: **tenant = organización**. Una organización tiene UN número
> de WhatsApp (una instancia de Evolution) y VARIOS usuarios que comparten los
> mismos leads y mensajes.

## 1. Objetivo

Que cada organización se registre, **vincule su propio WhatsApp escaneando un
QR** (como WhatsApp Web) y vea **solo sus propios leads y mensajes**, mientras
todas las organizaciones siguen recibiendo en paralelo a través de n8n.

Aclaración importante que motivó este plan: **el logout de Evolution no es una
herramienta para "cambiar de vista"** — desconecta el número y corta la
recepción. La separación entre organizaciones es un problema de *aislamiento de
datos*, no de conectar/desconectar WhatsApp.

## 2. Punto de partida (hoy es single-tenant)

- **Datos en un pool único.** `leads` (PK `remote_jid` = número del cliente) y
  `wsp_messages` (`chat_id` = número del cliente) no tienen dueño. Las escribe
  **n8n**, no la app; la app las lee. Ver [db/models.py](../backend/db/models.py).
- **Config global.** Evolution (URL, API key, instancia), n8n y ElevenLabs
  viven en `app_settings`, una sola fila por clave, global para todo el sistema.
  Ver [settings_service.py](../backend/services/settings_service.py).
- **Auth existe pero sin tenant.** Hay `users` con roles admin/vendedor
  ([auth_service](../backend/services/auth_service.py)), pero todos ven los
  mismos datos. El primer admin se siembra con `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
- **Tiempo real global.** `/ws/chats` hace `manager.broadcast(...)` a **todos**
  los clientes conectados ([ws_manager](../backend/services/ws_manager.py)).
- **Workers globales.** chat_watcher, automations, task_reminder,
  message_outbox y scheduled_messages recorren toda la base sin noción de
  organización.
- **Ya construido y reutilizable:** el flujo de QR/estado de conexión
  ([whatsapp.py](../backend/routers/whatsapp.py),
  [evolution_service.py](../backend/services/evolution_service.py),
  [WhatsappPanel.tsx](../frontend/src/components/WhatsappPanel.tsx)) es el
  ladrillo del onboarding por QR. No se tira.

## 3. Arquitectura objetivo

### 3.1 Modelo de datos
- Nueva tabla `organizations` (id, name, status, plan, created_at, …).
- `users.organization_id` FK → cada usuario pertenece a una organización. Los
  roles (admin/vendedor) pasan a ser **dentro de** la organización.
- `organization_id` en **todas** las tablas con datos de negocio: `leads`,
  `wsp_messages`, `lead_tasks`, `internal_notes`, `tags` (+ mapeos),
  `message_templates`, `automation_rules`, `automation_executions`,
  `notifications`, `lead_activity`, `message_outbox`, `media_library`,
  `scheduled_messages`.

### 3.2 El problema de la PK de `leads` (crítico)
Hoy `leads.remote_jid` es PK. Dos organizaciones pueden tener el **mismo cliente**
(mismo número) → colisión. Además muchas tablas referencian
`leads.remote_jid` por FK.

**Propuesta:** introducir una PK sustituta `lead_id` (bigint/uuid) y volver
`(organization_id, remote_jid)` un índice único. Las FKs pasan a apuntar a
`lead_id` (columna simple → migración de FKs más limpia que una PK compuesta).

Como `leads` y `wsp_messages` son tablas **externas que también escribe n8n**,
cualquier cambio de esquema hay que coordinarlo con el workflow de n8n (y con
cualquier otro sistema que lea esas tablas). Este es el punto de mayor riesgo.

### 3.3 Aislamiento (defensa en profundidad)
Un solo query sin filtrar por `organization_id` = fuga de datos de una
organización a otra. Dos capas, de menor a mayor garantía:

1. **Scoping obligatorio en la app.** Un dependency de FastAPI resuelve
   `current_user → organization_id` y lo inyecta en todos los servicios; un
   helper de repositorio que *exige* el org_id en cada consulta. Cubierto con
   tests que fallan si un endpoint devuelve datos de otra organización.
2. **Row-Level Security de PostgreSQL (hardening).** Políticas que filtran por
   `current_setting('app.current_org')`, seteado por transacción. Es la red de
   seguridad si un query se escapa del scoping. Se puede sumar en una etapa
   posterior (tiene fricción con async SQLAlchemy y tablas externas).

### 3.4 Evolution: una instancia por organización
- Nombre de instancia derivado de la org (ej. `org_<id>`).
- **Provisioning** al vincular: crear instancia (`POST /instance/create` si no
  existe) → setear su webhook hacia n8n (`POST /webhook/set/{instance}` con los
  eventos MESSAGES_UPSERT, CONNECTION_UPDATE, QRCODE_UPDATED) → mostrar QR (ya
  construido) → poll de estado (ya construido).
- Guardar por organización: nombre de instancia, token de instancia, y el
  estado de conexión. La config de Evolution pasa de global a **por org**
  (servidor/URL puede seguir siendo global; instancia/token es por org).

### 3.5 Ruteo en n8n
- Evolution manda el nombre de instancia en el webhook. n8n mantiene (o consulta
  a la app) un mapeo **instancia → organización** y escribe `organization_id` en
  cada `leads`/`wsp_messages` que inserta.
- La app expone un endpoint interno `instancia → org_id` para que n8n resuelva
  el mapeo, o n8n lo deriva del propio nombre `org_<id>`.

### 3.6 Tiempo real y workers
- **WebSocket por organización.** `ws_manager` deja de hacer broadcast global:
  agrupa sockets por org y emite solo a los de la misma organización. (Hoy una
  org vería los eventos de otra.)
- **Workers por organización.** Los watchers incluyen `organization_id` en sus
  consultas y en lo que emiten (broadcasts, automatizaciones, recordatorios).

### 3.7 Onboarding / signup
- El alta crea `organization` + primer usuario admin de esa org. Reemplaza el
  seed único `ADMIN_EMAIL`/`ADMIN_PASSWORD`.
- Billing, planes y límites: etapa final, no bloquean el resto.

## 4. Plan por etapas

| Etapa | Alcance | Resultado | Riesgo |
|---|---|---|---|
| **0. Fundaciones** | Tabla `organizations`; `users.organization_id`; la sesión/JWT lleva `org_id`; crear "organización por defecto" y asignarle TODO lo existente (backfill). | Sin cambio de comportamiento: sigue habiendo una sola org (la actual). | Bajo |
| **1. Scoping de datos** | `organization_id` en todas las tablas de negocio (backfill a la org por defecto) + PK sustituta en `leads` + **cada** query filtra por org + tests de aislamiento. | Aislamiento real a nivel app. Es el grueso del trabajo y lo crítico de seguridad. | **Alto** |
| **2. Evolution por org** | Config de instancia por org; provisioning (crear instancia + setear webhook); QR/estado ya existentes pasan a ser por org; endpoint instancia→org. | Cada org vincula su WhatsApp por QR. | Medio |
| **3. Ruteo en n8n** | n8n resuelve instancia→org y estampa `organization_id` en leads/mensajes. Coordinar el esquema de las tablas externas. | Los mensajes entrantes caen en la org correcta. | Medio-Alto (externo) |
| **4. Tiempo real + workers** | `ws_manager` por org; watchers con org_id. | Nada se filtra en tiempo real entre orgs. | Medio |
| **5. Signup + billing** | Alta de organización, planes, límites, facturación. | Producto SaaS vendible. | Medio |

## 5. Riesgos y decisiones abiertas
- **Fuga entre tenants** si un query se salta el filtro → mitigar con la capa de
  scoping obligatoria + tests, y RLS como hardening (etapa posterior).
- **Tablas externas (`leads`, `wsp_messages`)** compartidas con n8n → los
  cambios de esquema requieren coordinación y una ventana de migración.
- **Superficie enorme:** casi todos los routers/servicios se tocan en la etapa 1
  → alto riesgo de regresión; por eso va aislada y con tests.
- **Escala de Evolution:** muchas instancias en un servidor = límites de
  recursos; hará falta monitoreo y límites por plan.
- **Provisión de números / ToS de WhatsApp** por cliente: cada org aporta su
  número; definir el flujo de alta real.

## 6. Qué NO cambia
- El QR/estado de conexión ya construido se reutiliza (pasa a ser por org).
- El patrón de settings y la mayoría de la UI de leads/mensajes se conservan;
  lo que cambia por debajo es el *scope* de las consultas.

## 7. Próximo paso sugerido
Arrancar por la **Etapa 0** (fundaciones + backfill a "organización por
defecto"), que no cambia el comportamiento actual y deja la base lista para el
scoping de la Etapa 1. Confirmar antes el modelo de PK sustituta en `leads` con
quien mantenga el workflow de n8n, por ser tabla compartida.
