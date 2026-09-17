# Plan de arquitectura y migración a SaaS multi-tenant por esquema

> Revisión: **2026-09-17**.
> Estado: plan corregido contra el proyecto actual; todavía no implementado.
> Decisión de arquitectura: **un schema PostgreSQL por negocio**. El subdominio
> identifica la instancia web del negocio y se resuelve a un schema interno.
> Ejemplo: `clinica-lima.cliniventas.com` → organización registrada →
> `tenant_a3f81c...`.

## 1. Decisión y límites

Cada negocio tendrá una copia independiente de las tablas de la aplicación dentro
de su propio schema PostgreSQL. Las tablas del negocio no llevarán
`organization_id`: su pertenencia está dada por el schema que las contiene.

El subdominio es la identidad pública del negocio, pero **no se concatena en SQL**.
El backend lo valida y busca en un registro común. Ese registro devuelve un nombre
de schema generado por el sistema, inmutable y seguro. Cambiar el subdominio no
renombra ni mueve el schema.

La solución tendrá dos planos:

| Plano | Schema | Contenido |
|---|---|---|
| Control de plataforma | `public` | Organizaciones, dominios/subdominios, conexiones de WhatsApp, estado de aprovisionamiento y migraciones, configuración estrictamente global |
| Datos del negocio | `tenant_<id_interno>` | Copia de las tablas actuales: usuarios, sesiones, leads, mensajes, tareas, plantillas, automatizaciones, archivos registrados, settings del negocio, etc. |

No se habilitará una segunda organización hasta que resolución de subdominio,
sesiones, pool SQL, workers, webhooks, archivos, eventos y migraciones funcionen
con aislamiento de schema.

## 2. Estado actual comprobado

- [db/models.py](../backend/db/models.py) declara 33 tablas en un único namespace.
- [db/session.py](../backend/db/session.py) usa un único engine y pool; no fija
  `search_path` ni schema por transacción.
- Las consultas están repartidas entre `services/store/*` y servicios que abren
  sesiones directamente. La fachada `db_service.py` ya fue parcialmente separada.
- Las sesiones de usuario son tokens opacos persistidos en `auth_sessions`; no JWT.
- [ws_manager.py](../backend/services/ws_manager.py) mantiene conexiones en memoria
  y `broadcast()` sigue siendo global.
- Los workers recorren las tablas únicas actuales. `chat_watcher` ya pagina por
  `(sent_at, id)`, pero mantiene un cursor global en memoria.
- `app_settings`, clientes de proveedor y caches de configuración son globales.
- Los archivos `/media/{filename}` requieren sesión, pero la autorización actual
  no comprueba un negocio propietario.
- Los tres exports locales de n8n están ignorados por Git. `analista.json` aún
  contiene cinco nodos PostgreSQL; `rag.json` combina ingesta Evolution con
  sugerencias y usa Supabase `documents` sin filtro tenant configurado. El workflow
  Meta guarda mensajes vía API, pero no conserva `phone_number_id` para ruteo.
- Hay una sola head Alembic, `c9a2e6f83d51`, con padre `c4e8a1d6f239`. El control
  de migraciones SQL históricas pasa y no hay conflictos Git pendientes.

La arquitectura actual no puede seleccionar schemas solo cambiando Traefik: el
contexto debe llegar a cada transacción, job y evento interno.

## 3. Plano de control en `public`

Crear únicamente las tablas comunes necesarias para localizar y administrar un
tenant. Una propuesta mínima:

```text
public.organizations
  id UUID PK
  name
  status: provisioning | active | suspended | failed | deleting
  schema_name UNIQUE NOT NULL
  created_at, activated_at

public.organization_domains
  id UUID PK
  organization_id FK
  hostname UNIQUE NOT NULL
  is_primary
  verified_at

public.whatsapp_connections
  id UUID PK
  organization_id FK
  provider
  phone_number_id UNIQUE
  waba_id
  encrypted_credentials / secret_reference
  credential_version
  status

public.tenant_schema_versions
  organization_id PK/FK
  revision
  migration_status
  started_at, finished_at, last_error

public.platform_settings
  key PK
  encrypted_value
```

`schema_name` no será el slug. Debe generarse desde un UUID, por ejemplo
`tenant_` más el UUID sin guiones, y comprobarse contra una expresión cerrada
como `^tenant_[0-9a-f]{32}$`. Solo se aceptan nombres recuperados desde
`public.organizations`; nunca se usa directamente el `Host`, un header del cliente
ni un valor de n8n como identificador SQL.

Las credenciales comunes de la app Meta, cifrado, infraestructura y servicios de
plataforma viven en `public.platform_settings`. La configuración de cada negocio
sigue en su propia `app_settings`, dentro de su schema. El token y número de
WhatsApp tienen una sola fuente de verdad en `public.whatsapp_connections` porque
se necesitan para enrutar webhooks antes de conocer el schema.

No crear FK PostgreSQL desde `public` hacia tablas tenant ni entre dos schemas
tenant. El backend mantiene esa frontera. La eliminación de una organización será
una operación de plataforma separada, auditada y con retención; no un `DROP SCHEMA`
desde una ruta ordinaria.

## 4. Tablas duplicadas por negocio

Cada schema tenant contendrá una copia de estas 33 tablas del modelo actual:

```text
leads
whatsapp_identities
wsp_ad
wsp_messages
message_outbox
scheduled_messages
app_settings
users
trusted_devices
auth_sessions
lead_tags
lead_services
template_categories
lead_tag_assignments
lead_activity
lead_notes
lead_note_mentions
user_notifications
push_subscriptions
issue_reports
issue_report_attachments
issue_report_comments
issue_report_events
appointments
lead_tasks
message_templates
template_user_state
media_assets
template_attachments
automation_rules
automation_flow_versions
automation_round_robin_state
automation_executions
```

Las PK, FK, índices, triggers, enums, secuencias y restricciones se crean dentro
de cada schema. Las unicidades actuales pasan a ser naturalmente locales al
negocio: el mismo email, teléfono, JID, `wa_message_id`, tag o shortcut puede
existir en dos schemas sin colisión.

Se conservan las restricciones internas actuales; no deben quitarse por usar
schemas. Por ejemplo, el outbox sigue siendo único por mensaje dentro del tenant,
las FK siguen impidiendo relacionar un lead con un usuario inexistente en ese
schema y el dedupe continúa funcionando localmente.

Antes de la migración se inventariarán objetos reales fuera del ORM: columnas,
triggers, funciones, tipos, tablas `n8n_*` y objetos históricos. `analista.json`
todavía lee y escribe tablas de negocio; `rag.json` usa conocimiento en Supabase.
Los exports no prueban el contenido de una instancia desplegada. Cada objeto
activo debe clasificarse como plataforma, tenant o ajeno.

### 4.1 Tipos y extensiones

Las extensiones PostgreSQL se instalan una sola vez. Para enums y otros tipos hay
que elegir una estrategia explícita:

- Tipos realmente comunes, estables y administrados por la plataforma pueden
  vivir en `public` y ser referenciados con schema explícito.
- Tipos que evolucionen junto a las tablas tenant deben existir dentro de cada
  schema y ser gestionados por el migrador tenant.

No depender de resolución accidental de tipos mediante `search_path`. La baseline
debe crear en orden schema, tipos, tablas, secuencias, FK, índices, funciones y
triggers.

## 5. Resolución del tenant por subdominio

### 5.1 Entrada HTTP

Añadir middleware temprano que:

1. Obtenga el hostname efectivo desde una cadena de proxies confiable.
2. Normalice minúsculas, quite puerto y punto final, y rechace hostnames inválidos.
3. Exija coincidencia exacta con el dominio base configurado, por ejemplo
   `<slug>.cliniventas.com`. `www`, dominio raíz, panel de plataforma y hosts de
   desarrollo se tratan explícitamente.
4. Consulte `public.organization_domains.hostname` mediante una sesión de control.
5. Compruebe `organizations.status = 'active'`.
6. Guarde un `TenantContext(organization_id, schema_name, hostname)` inmutable en
   `request.state`.

El backend no debe confiar ciegamente en `X-Forwarded-Host`: Nginx/Traefik deben
sobrescribirlo y el backend solo debe aceptar encabezados forwarded desde proxies
conocidos. Las conexiones directas al puerto del backend deben rechazarse o estar
aisladas por red.

La infraestructura necesita DNS wildcard `*.cliniventas.com`, certificado TLS
wildcard o emisión equivalente y una regla Traefik `HostRegexp` limitada al dominio
base. CORS debe usar una expresión anclada que solo acepte esos subdominios, no una
regex abierta. Nginx ya conserva `Host`, pero se debe probar HTTP y WebSocket.

El slug público tiene lista cerrada de caracteres, longitud limitada y palabras
reservadas. Cambiarlo actualiza el dominio registrado y DNS, no `schema_name`.
Dominios personalizados futuros entran como filas verificadas de
`organization_domains`, sin cambiar el modelo de datos.

### 5.2 Sesiones y cookies

Las tablas `users`, `auth_sessions` y `trusted_devices` viven dentro del schema del
negocio. Primero se resuelve el hostname; luego se busca el token en ese schema.
Así, el mismo email puede existir en diferentes negocios.

Usar cookies host-only: no establecer `Domain=.cliniventas.com`. Una sesión iniciada
en `negocio-a` no debe viajar a `negocio-b`. La caché de sesión se indexa al menos
por `(organization_id, token_hash)` y se invalida entre réplicas al revocar usuario,
sesión u organización. WebSocket repite resolución de hostname y sesión antes de
registrarse.

Un eventual panel de operador de plataforma debe usar hostname, rutas, cookies,
tablas y permisos separados; no reutilizar el rol `admin` de un negocio.

## 6. Selección segura de schema en SQLAlchemy

Mantener un engine/pool compartido es razonable. No crear un pool por tenant: con
muchos negocios agotaría conexiones. El aislamiento ocurre por transacción.

Crear dos fábricas:

- `control_session()` fija `search_path` a `public` y solo expone repositorios del
  plano de control.
- `tenant_session(context)` abre una transacción y ejecuta antes de cualquier
  consulta `SET LOCAL search_path TO <schema_validado>, public`, o el equivalente
  seguro con `set_config`. El schema proviene únicamente del registro validado.

`SET LOCAL` es obligatorio porque la conexión vuelve al pool. Un `SET search_path`
de sesión puede dejar el schema de A activo cuando esa conexión se entregue a B.
Al cerrar la transacción se debe verificar/restablecer el estado; las pruebas deben
forzar reutilización de la misma conexión en secuencia A → B → control.

No interpolar identificadores con parámetros de valor. PostgreSQL no parametriza
nombres de schema. Validar el nombre generado y citarlo con el preparador del
dialecto o usar `schema_translate_map` con metadatos diseñados para ello. Elegir
un mecanismo único para toda la aplicación. La recomendación para el código actual,
que usa tablas sin schema explícito y SQL crudo, es `SET LOCAL search_path` dentro
de una abstracción de sesión tenant, más schemas explícitos para tablas `public`.

Toda función de negocio recibe `TenantContext` o una sesión tenant ya construida.
Queda prohibido llamar `get_sessionmaker()()` directamente desde servicios de
negocio. Añadir un test estático para evitar nuevas aperturas fuera de las fábricas
autorizadas.

Las operaciones deben usar una transacción desde la selección del schema hasta el
commit. Tareas asíncronas no comparten `AsyncSession`; crean una sesión nueva con
el mismo contexto. SQL crudo con `public.` o un schema tenant codificado requiere
revisión explícita.

### 6.1 Defensa adicional

Separar por schema reduce errores de filtros, pero `search_path` no es una frontera
de permisos si el mismo rol tiene acceso a todos los schemas y una consulta puede
calificar `otro_schema.tabla`. Aplicar estas defensas:

- Revocar `CREATE` en `public` al rol runtime.
- Revocar uso a schemas no necesarios por defecto.
- Prohibir nombres de schema aportados por clientes.
- Limitar el acceso del código de negocio a la fábrica tenant.
- Auditar SQL calificado y funciones `SECURITY DEFINER`.
- Para aislamiento fuerte futuro, evaluar roles por tenant o conexiones mediadas;
  tienen mayor coste operativo y de pool, por lo que no forman parte del primer
  despliegue.

RLS con `organization_id` ya no es el mecanismo principal porque las filas tenant
no comparten tabla. Puede utilizarse en tablas comunes si alguna contiene datos
sensibles de varias organizaciones, pero no reemplaza la selección segura de schema.

## 7. Webhooks, n8n y WhatsApp

**Decisión: Meta Cloud API entra directamente al webhook de n8n; `rag` y
`analista` son subworkflows invocados a demanda.** El backend conserva la
autoridad sobre datos, permisos y selección de schema. Esto no obliga a mover
la URL pública de Meta a FastAPI.

El subdominio identifica el negocio para usuarios web. Meta usa una URL central:
su identidad de ruteo es `metadata.phone_number_id`, resuelta por el backend a
conexión → organización → schema. Nunca se deduce el tenant del teléfono del
cliente, de una instancia sintética ni del dominio fijo del workflow.

### 7.1 Evidencia y responsabilidades actuales

Se revisaron los tres exports locales disponibles el 2026-09-17. Están ignorados
por Git; no son archivos versionados ni prueban qué versión está desplegada.
El [análisis de workflows](analisis/10-workflows-n8n-meta-multitenant.md) detalla
ramas, fallos reproducidos y diferencias de contratos.

| Export | Qué hace hoy | Cambio necesario |
|---|---|---|
| `webhook meta cloud api.json` | Verifica GET, normaliza POST, guarda mensajes/medios, estados y reacciones vía backend. No invoca los agentes | Mantener como entrada Meta; añadir ruteo por número, recepción durable y corregir normalización |
| `rag.json` | GET para sugerencias; entrada de subworkflow para ingesta Evolution; POST adicional para contenido/medios; herramientas Supabase/catálogo | Extraer el copiloto como subworkflow independiente; desacoplar ingesta y análisis de adjuntos |
| `analista.json` | Subworkflow de clasificación/extracción del lead, con espera, cinco nodos PostgreSQL y actualización de etapa por HTTP | Ejecutarlo a demanda, eliminar SQL y aplicar resultados mediante backend tenant-aware |

El disparador `When Executed by Another Workflow` de `rag` **no conduce hoy al
copiloto**, sino a la ingesta legacy. En esa rama, `Call analista` se dispara
sin esperar su terminación, incluso si el mensaje ya existía. No conectar Meta
a ese disparador para obtener sugerencias: reintroduciría ingesta y análisis
automático que no forman parte del diseño solicitado.

### 7.2 Flujo de destino

```text
Meta Cloud API
  → webhook público de n8n
  → verificar autenticidad + registrar sobre en inbox durable
  → responder 200 tras confirmar recepción durable
  → procesar cada change conservando phone_number_id
  → API interna: resolver conexión y organization/schema
  → guardar/deduplicar mensaje + evento de salida en una transacción
  → publicar a la web del negocio; procesar estados/reacciones sin IA

Usuario o regla explícita del negocio
  → backend con TenantContext del subdominio o del job autorizado
  → registrar solicitud y contexto/revisión
  → workflow de despacho autenticado en n8n
      → rag: sugerencias para el asesor
      → analista: clasificación y campos del lead
  → backend valida resultado, vigencia y operación
  → guardar en el schema original y avisar a ese tenant
```

La inbox puede implementarse mediante una API del backend llamada por n8n o una
cola durable confirmada. Es trabajo de recepción breve, sin esperar IA ni descargas
de medios. Si se usa inbox de plataforma antes de resolver el tenant, restringirla
al servicio de ingesta y definir retención; los mensajes definitivos viven en el
schema del negocio. Los fallos posteriores al 200 requieren reintento/replay
persistente; los retries de nodos HTTP por sí solos no cierran ese circuito.

La ingesta actual puede ejecutar automatizaciones del backend mediante
`/api/webhooks/messages`. Eso no debe convertirse en una llamada incondicional
a los agentes. Una regla que solicite análisis es demanda explícita, con cuota e
idempotencia. El analista tampoco tiene que ejecutarse antes de cada sugerencia.

### 7.3 Separar el copiloto, el analista y los adjuntos

- **`rag`** recibe contexto del lead, historial, instrucción del asesor y
  configuración autorizada del negocio. Consulta conocimiento/catálogo de ese
  tenant y devuelve sugerencias; no guarda mensajes ni decide la etapa.
- **`analista`** recibe una solicitud de análisis y contexto versionado.
  Devuelve clasificación y campos propuestos; el backend valida y aplica cambios
  auditados. No controla pausas de automatización ni versiones de conversación.
- **Adjuntos**: preservar transcripción/descripción que hoy realiza la rama
  legacy de `rag` en un subworkflow específico si se necesita esa capacidad.
  Meta ya importa medios por `/meta-media`, pero importar no produce análisis IA.
  El mensaje debe existir aunque falle la extracción. Asociar resultado a un
  `message_id` y job del mismo tenant; no ejecutar la ingesta Evolution para ello.
- **Indexación RAG**: separar carga de documentos de consultas de sugerencias.
  La rama de inserción Supabase del export no está conectada a sus disparadores.

El subworkflow del copiloto necesita un `Execute Sub-workflow Trigger` que llegue
al agente y un nodo final de retorno. Sustituir referencias a
`$('Webhook1').item.json.query` por inputs explícitos. La respuesta HTTP queda
en el workflow de despacho. Así funciona el retorno de subworkflows según
[n8n Execute Sub-workflow](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.executeworkflow).

Mantener temporalmente el adaptador de sugerencias actual (GET con `chat_id`,
`refresh`, `instruction` y respuesta `[{"output": {...}}]`) o cambiar backend y
wrapper juntos. No devolver el ID de ejecución donde el backend espera
`SuggestionResponse`. Para ejecución asíncrona, implementar antes contrato de
job/estado y UI correspondiente. La compatibilidad actual de
`routers/suggestions.py` permite cambiar etapa si llega `output.estado`;
retirar esa responsabilidad del contrato del copiloto.

### 7.4 Contratos y autorización

Usar una URL interna estable y autenticada; no construir URLs desde subdominios,
payloads o texto generado por IA. Separar dos contratos:

| Contrato | Identidad y deduplicación | Autoridad |
|---|---|---|
| Evento Meta | App receptora, `phone_number_id`, tipo y clave estable del evento, payload | Autenticidad del proveedor + credencial de ingesta; backend resuelve conexión/tenant |
| Solicitud IA | `contract_version`, `job_id`, operación, recurso y revisión de contexto | Job creado por backend, token limitado a ese job, tenant y operación |

`tenant_id` sirve para trazabilidad; no autoriza. Una llamada de IA no necesita
inventar `connection_id` si la operación solo consulta el lead. Un evento entrante
tampoco necesita un job de IA. El backend enlaza cualquier conexión/recurso
declarado al tenant autenticado y rechaza inconsistencias.

El job pertenece al schema del tenant. Para localizarlo en un callback antes de
abrir sesión SQL, usar contexto de tenant firmado por el backend o un índice de
ruteo mínimo en control; nunca confiar en un `tenant_id` arbitrario. Verificar
expiración, suspensión, operación y recurso al consumirlo. No enviar nombre de
schema, credenciales SQL/Meta ni URLs elegidas por el modelo.

Conservar identidad por **cada ítem** de lotes y subworkflows, también en errores
y replays. Prohibir static data global para recordar el tenant. Las claves de
dedupe incluyen conexión y clase de evento: no deduplicar todos los estados de un
mensaje únicamente por `wa_message_id`, pues descartaría delivered/read posteriores.
El backend debe insertar mensaje y outbox de notificación atómicamente; el dedupe
de inserción no puede omitir una notificación pendiente.

### 7.5 Cambios imprescindibles en los exports y APIs

1. **Meta**: conservar `metadata.phone_number_id` por cada `change`, eliminar
   `dermicapro-business` como identidad, resolver contactos por `msg.from` y admitir
   ausencia de perfil/username. Se reprodujeron excepción sin `contacts`,
   `@null` y asignación del primer username a otro remitente.
2. **Recepción**: revisar verificación POST en el ingress real. No se observa
   validación de firma en el export; el challenge GET no demuestra esa validación.
   Confirmar durabilidad antes del 200 y recuperación después del guardado aunque
   falle `avisar al backend`.
3. **Analista**: reemplazar sus cinco nodos Postgres por contratos backend
   equivalentes y tenant-aware. `update lead` y `update lead4` fijan
   `conversacion_version = 0`; el segundo además fija
   `automatizacion_pausada = false`. Eliminar esas escrituras.
4. **Paridad de análisis**: `LeadAnalysisWebhookBody` aún no admite
   `proxima_cita` ni `con_especialista`, usados por el export. Además
   `lead-analysis` descarta nulls con `exclude_none=True`. Definir campos y
   semántica de patch: ausente conserva, null explícito limpia campos permitidos.
   Validar citas/fechas y propiedad de campos antes de sustituir nodos.
5. **Actividad**: `update lead4` lee `data[0].created_at`, pero la consulta
   `get messages1` selecciona `sent_at`. Corregir el contrato y mantener
   último emisor/fecha en la ingesta, sin depender de invocar al analista.
6. **Concurrencia IA**: el analista comprueba el último mensaje antes del modelo,
   pero no después. Validar atómicamente una revisión de contexto al aplicar el
   resultado para no sobrescribir mensajes, análisis o ediciones humanos recientes.
   `conversacion_version` actual no es un contador por mensaje.
7. **Configuración**: sacar de prompts/nodos URLs de DermicaPro, catálogo,
   servicios, horarios, políticas, recursos y reglas telefónicas particulares.
   El backend entrega configuración del tenant; el LLM no selecciona tenant.
8. **Contratos verificables**: fixtures sanitizadas de los tres workflows,
   sin secretos ni `pinData` real. El test actual `test_n8n_contract.py`
   busca solo `docs/rag*.json` y permite nombres SQL heredados; no verifica
   `analista.json` de la raíz ni garantiza ausencia de acceso SQL.

### 7.6 Aislar también el conocimiento RAG

`rag` no tiene nodos Postgres convencionales, pero usa Supabase Vector Store:
consulta `documents` con `RAG1`, sin filtro tenant configurado. Su rama de
indexación añade `tipo` y `titulo` como metadata, sin pertenencia de negocio.
Aislar solo leads y mensajes dejaría el conocimiento fuera del diseño.

Para mantener schema por negocio, añadir tablas de documentos/chunks e índices
vectoriales en cada schema y exponer recuperación/indexación mediante el backend.
Estas son **tablas nuevas**, adicionales a las 33 actuales; incluirlas en baseline,
aprovisionamiento, migraciones, backups y borrado de tenant. Inventariar y migrar
el contenido real de Supabase antes de retirar esa integración.

La herramienta del agente recibe una consulta; el backend fija el schema desde
el job autorizado. No permitir que el modelo envíe o cambie schema/tenant.
Catálogo, precios, flyers, prompts y cache de resultados siguen el mismo contexto.
Si se conserva temporalmente Supabase, se requiere aislamiento comprobado en el
servicio de recuperación y en la indexación; un filtro opcional elegido por IA
no es autorización. No habilitar un segundo tenant con `documents` sin aislamiento.

### 7.7 Despliegue, operación y transición de proveedor

Una instancia n8n con workflows compartidos es compatible con este diseño.
Duplicar tablas por schema **no exige duplicar workflows**. Las otras opciones
siguen disponibles: workflows separados para personalización, o instancias
separadas para aislamiento operativo; ninguna sustituye la autorización backend.

Reservar acceso al editor/ejecuciones compartidas a operadores de plataforma.
Los historiales, errores y binarios también contienen datos de negocios: limitar
retención y acceso, sanear logs, evitar base64 persistido y verificar limpieza del
almacenamiento usado. Aplicar cuotas, concurrencia y métricas por tenant, con
replay que revalide el job/conexión. La DB interna de n8n no tiene permisos sobre
tablas de negocio. Usar URLs de medios limitadas al recurso y tiempo necesarios.

Meta es el destino de la ingesta. Mantener Evolution solo para las conexiones que
aún lo necesiten, detrás de un adaptador separado. Inventariar callers reales de
`rag`, `Webhook4`, `pixel lead` y subworkflows CTWA antes de retirarlos: el
export de `rag` referencia automatizaciones publicitarias cuyo contenido no está
incluido. Conservar atribución/referral sin duplicar conversiones durante cutover.

El Embedded Signup se inicia en el subdominio autenticado. Ligar el intento de
uso único a la organización, validar token/WABA/número y guardar la conexión en
`public.whatsapp_connections`. Los adaptadores `WhatsAppChannel`, importación
Meta, envíos, plantillas y caches de credenciales usan esa conexión, no
`current_channel()` global. Citas y otros callbacks usan el tenant del job que
los originó. Eventos de número desconocido o suspendido nunca caen en el primer
negocio como fallback.

## 8. Workers, eventos y tiempo real

Un worker global no puede consultar una tabla `message_outbox` única. El
coordinador enumera organizaciones activas desde `public`, aplica límites y equidad,
y ejecuta cada unidad de trabajo dentro de `tenant_session(context)`.

Cubrir al menos:

- `message_outbox` y `scheduled_messages`;
- automatizaciones, esperas y ejecuciones pausadas;
- recordatorios, notificaciones y push;
- cierre automático de conversaciones;
- watcher/resincronización de chats;
- mantenimiento, métricas y limpiezas.

Cada tenant tiene cursores, leases y dedupe independientes. El cursor de
`chat_watcher` pasa a ser por organización y durable si dispara efectos que deban
recuperarse. El coordinador no concede `search_path` global ni comparte sesión
entre tenants. Un fallo en un schema no detiene a los demás; se registra por
organización sin exponer contenido sensible.

Registrar WebSocket por `(organization_id, user_id, session_id)`. Todo evento
interno lleva `organization_id` en su sobre de transporte aunque las tablas tenant
no tengan esa columna, porque el bus vive fuera de sus schemas. El consumidor usa
ese ID para seleccionar destinatarios y, si necesita DB, resolver el schema.

Para varias réplicas, RabbitMQ necesita fanout por réplica para eventos de UI; una
cola de consumidores competidores entrega cada evento a una sola réplica. Un bus
en memoria no alcanza. Los avisos locales `_wake`/`_wakeup` son optimizaciones:
polling o cola durable debe recuperar trabajo perdido.

Las claves React Query deben incluir la identidad del negocio o vaciarse totalmente
al salir/cambiar hostname. Cancelar requests pendientes, cerrar sockets y limpiar
estado evita que una respuesta tardía de A aparezca después de entrar a B.

## 9. Archivos y MinIO

Separar objetos nuevos por prefijo estable de organización, por ejemplo
`tenants/<organization_uuid>/...`, nunca por slug mutable. Registrar dentro del
schema tenant todos los objetos que ese negocio puede leer: mensajes, biblioteca,
adjuntos, reportes, TTS, comprobantes y uploads aún no asociados.

Después de resolver hostname y sesión, GET/HEAD/Range de `/media/{filename}` debe
buscar la propiedad en el schema activo antes de leer disco o MinIO. Aplicar la
misma autorización a forward, reutilización, descarga interna y borrado. Un bucket
privado y un nombre aleatorio no bastan.

El backfill de archivos históricos deriva propietario por sus referencias y genera
un reporte de huérfanos. No adivinar ni mover archivos como condición obligatoria
del primer corte: se puede mantener una tabla de mapeo autorizada y migrarlos por
lotes después.

## 10. Aprovisionamiento y migraciones Alembic

### 10.1 Crear un negocio

El alta será una saga idempotente administrada por plataforma:

1. Reservar organización, hostname y `schema_name` en `public` con estado
   `provisioning`.
2. Tomar advisory lock derivado del ID de organización.
3. Crear el schema con el rol de migraciones.
4. Ejecutar la baseline tenant hasta la revisión esperada.
5. Crear settings iniciales y primer admin dentro del schema tenant.
6. Ejecutar comprobaciones de integridad.
7. Marcar versión y organización como `active`.

Si falla, queda `failed` con error operativo saneado y puede reintentarse desde el
último paso seguro. Nunca se activa un schema parcialmente creado. No usar
`CREATE TABLE ... LIKE` ni copiar un schema plantilla: es fácil omitir FK, triggers,
secuencias, permisos o cambios posteriores. Alembic es la fuente de verdad.

### 10.2 Versionar schemas

Separar migraciones del plano de control y del plano tenant. Las revisiones tenant
deben poder ejecutarse repetidamente sobre distintos schemas mediante un parámetro
interno validado. Registrar revisión/estado por organización en `public` y,
opcionalmente, una `alembic_version` dentro de cada schema como verificación local.

[alembic/env.py](../backend/alembic/env.py) y
[scripts/migrate.py](../backend/scripts/migrate.py) hoy suponen un solo schema y
una sola fila de versión. Deben transformarse en un migrador que:

- migre primero `public`;
- enumere tenants con paginación;
- tome lock global de despliegue y lock por tenant;
- aplique la misma revisión a cada schema;
- continúe o detenga según política explícita, registrando fallos;
- no marque el release listo mientras exista un tenant activo incompatible.

El tiempo de despliegue crece con el número de negocios. Las migraciones serán
expand/contract y compatibles con la versión anterior durante blue-green. Para
índices grandes, diseñar fases fuera de transacciones cuando se use
`CREATE INDEX CONCURRENTLY`; el runner actual abre `engine.begin()` y no puede
ejecutarlo allí sin adaptación.

La comprobación de readiness no debe consultar una única `alembic_version`: valida
versión de control y que todos los tenants activos estén dentro del rango compatible
con ese binario. Un tenant fallido puede permanecer deshabilitado sin servir tráfico,
pero debe bloquear su hostname y workers.

## 11. Migración del negocio actual

La migración inicial evita copiar millones de filas cuando es posible:

1. Restaurar una copia reciente de producción y levantar inventario real.
2. Crear tablas de control en `public` y registrar la organización actual, su
   hostname, schema inmutable y conexión WhatsApp.
3. Detener temporalmente escrituras de API, workers y workflows o desplegar una
   ventana de compatibilidad bien definida.
4. Crear el schema del tenant.
5. Mover las tablas de negocio existentes con `ALTER TABLE ... SET SCHEMA` en un
   orden/procedimiento ensayado. PostgreSQL conserva datos e identidades de objetos,
   pero se deben verificar FK, secuencias, índices, defaults, tipos, funciones,
   triggers y referencias calificadas.
6. Dejar en `public` solo las tablas de control. Dividir `app_settings`: mover
   configuración del negocio al schema tenant y mantener únicamente plataforma.
7. Adaptar n8n/webhooks y desplegar el backend que selecciona schema.
8. Conciliar conteos, checksums muestrales, secuencias, nulos, jobs pendientes,
   sesiones, archivos y eventos.
9. Ejecutar pruebas de aislamiento con dos schemas y habilitar el primero.
10. Crear un segundo tenant piloto mediante el mismo aprovisionador, no a mano.

No se debe crear primero una copia y dejar las tablas antiguas activas sin una
fuente de verdad clara. Si `ALTER TABLE SET SCHEMA` resulta inviable por objetos
externos, usar copia con doble escritura o pausa controlada, validar y hacer un
cutover explícito. La elección se toma después del inventario y ensayo con volumen.

Las tablas `leads` y `wsp_messages` están excluidas actualmente de autogenerate.
Su traslado y baseline deben declararse manualmente. Antes de retirar
`EXTERNAL_TABLES`, completar el mapeo de columnas reales para evitar DDL destructivo.

## 12. Blue-green y rollback

El script actual migra la DB compartida antes de cambiar de color. Con schemas por
tenant, el binario anterior y el nuevo deben tolerar la misma fase expandida.
No ejecutar cambios contractivos hasta retirar todas las réplicas/workers viejos.

Durante la migración inicial, rollback significa volver a una release compatible
con las tablas ya movidas o revertir el ruteo mediante un procedimiento ensayado;
cambiar el color no devuelve tablas a `public`. Después de crear el segundo tenant
queda prohibido volver a un binario que opere siempre sobre `public`.

Ante fallo de migración de un tenant: mantenerlo inactivo, conservar sus jobs y
resolver/reintentar. No apuntarlo al schema del negocio inicial. Restaurar backup
es recuperación de desastre coordinada con replay de eventos posteriores, no el
rollback normal.

## 13. Secuencia de implementación

| Etapa | Entrega | Condición de salida |
|---|---|---|
| 0. Inventario | Esquema real, objetos externos, workflows desplegados, volumen y revisión por entorno | Backup restaurado y baseline entendida |
| 1. Control | Tablas `public`, modelo de organización/dominio/conexión y wildcard de infraestructura | Host inválido/desconocido falla cerrado |
| 2. Sesiones tenant | `TenantContext`, `control_session`, `tenant_session` y tests de reutilización del pool | A → B → control nunca conserva schema anterior |
| 3. Código scoped | Servicios, auth, settings, proveedores, medios, frontend y WebSocket | Dos schemas pasan CRUD cruzado sin fuga |
| 4. Async/integraciones | Workers, bus, contrato n8n tenant-aware, Meta/Evolution y callbacks | Sin hosts/instancias fijas; ruteo, reintento, DLQ y fanout conservan tenant |
| 5. Migrador | Alembic control/tenant, aprovisionador y readiness por versión | Instalación limpia y upgrade de varios tenants pasan |
| 6. Cutover actual | Mover datos actuales, conciliar y retirar fallbacks a `public` | Negocio actual estable desde su subdominio/schema |
| 7. Piloto | Segundo negocio creado por el aprovisionador | Checklist §14 completo |
| 8. Producto | Signup, invitaciones, planes, límites, billing y dominios personalizados | Alta/baja idempotentes y auditadas |

## 14. Pruebas y criterio para el segundo negocio

- [ ] Host válido resuelve una única organización activa; host falso, IP directa,
      dominio parecido y headers forwarded manipulados fallan cerrados.
- [ ] El nombre del schema nunca procede directamente del subdominio ni de n8n.
- [ ] Una misma conexión física del pool usada A → B → control no mezcla datos.
- [ ] Todo servicio de negocio usa `tenant_session`; el test estático evita nuevas
      sesiones globales y SQL tenant calificado.
- [ ] Mismos email, teléfono, JID, `wa_message_id`, tag y shortcut coexisten en A/B.
- [ ] IDs conocidos de B no permiten leer, editar, asociar, enviar ni descargar
      desde A.
- [ ] Cookies son host-only; logout/login, PIN, cache, push y fetches tardíos no
      cruzan subdominios.
- [ ] GET/HEAD/Range, forward y borrado de archivos validan propiedad en el schema.
- [ ] Meta y Evolution resuelven conexión → organización → schema, incluso en lotes
      mixtos, estados tardíos, reacciones, ecos, medios y reintentos.
- [ ] Los workflows n8n no contienen hosts de clientes, túneles, instancia fija,
      nombres de schema ni nodos con acceso a PostgreSQL de negocio.
- [ ] Sugerencias, análisis y citas usan `job_id/event_id` idempotentes; modificar
      `tenant_id`, `connection_id` o recurso en un callback produce rechazo.
- [ ] Meta recibe y guarda sin ejecutar RAG/analista automáticamente; cada agente
      se invoca a demanda con contrato independiente y retorno verificado.
- [ ] Normalización admite perfiles ausentes y lotes con distintos contactos y
      números; fallos posteriores al 200 y al guardado se recuperan sin pérdida.
- [ ] Indexación, búsqueda vectorial, catálogo, prompts y caches mantienen
      aislamiento A/B; el agente no puede elegir un tenant en sus herramientas.
- [ ] Analista conserva paridad de campos/nulls, respeta pausas de automatización
      y rechaza resultados obsoletos sin reiniciar `conversacion_version`.
- [ ] Retención, pruning, acceso a ejecuciones, binarios, logs y replay de n8n se
      probaron con datos A/B; una persona autorizada para A no puede inspeccionar B.
- [ ] Cuotas/concurrencia por tenant evitan que una ráfaga de A bloquee trabajos de B.
- [ ] Outbox, programados, automatizaciones y recordatorios recorren tenants con
      equidad y no reutilizan contexto SQL.
- [ ] Dos réplicas reciben eventos solo para sockets de la organización correcta.
- [ ] Suspender un negocio bloquea HTTP, WebSocket, workers y nuevos efectos externos.
- [ ] Aprovisionamiento interrumpido es reanudable y nunca activa schema parcial.
- [ ] Migraciones de control y tenant funcionan en base vacía, negocio actual y
      varios schemas; readiness detecta versiones incompatibles.
- [ ] Blue-green y rollback tenant-aware fueron ensayados sin volver a tablas
      compartidas en `public`.
- [ ] Backup fue restaurado y los conteos, secuencias, jobs y archivos conciliados.

## 15. Próximo paso

Implementar primero la etapa 0 y diseñar dos líneas Alembic: control y tenant.
Después crear `TenantContext`, `control_session()` y `tenant_session()` con pruebas
de pool. Es la costura que permite adaptar gradualmente el resto sin agregar
`organization_id` a las 33 tablas ni depender de filtros manuales en cada query.

Esta revisión reemplaza las secciones anteriores que proponían aislamiento por
fila y RLS sobre tablas compartidas. RLS queda limitado a casos comunes puntuales;
el aislamiento principal es schema por negocio, resuelto desde el subdominio.
