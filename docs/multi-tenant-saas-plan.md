# Plan de arquitectura y migración a SaaS multi-tenant

> Revisión: **2026-09-16**, reemplaza la propuesta del 2026-09-09.
> Estado: diseño actualizado mediante inspección del repositorio; **no es una
> migración implementada ni una validación de producción**.
> Modelo: tenant = organización; varios usuarios comparten sus datos y una
> organización tiene como máximo un número de WhatsApp activo en esta primera versión.
> **No habilitar una segunda organización hasta aislar datos, credenciales,
> ingesta, workers, archivos y tiempo real.**

## 1. Estado real y correcciones al plan anterior

La revisión contrasta modelos, servicios, routers, frontend, revisiones Alembic,
despliegue y los cinco workflows JSON versionados. No se consultó la base real,
la configuración de Meta ni qué workflows están activos en n8n. La presencia de
un archivo no demuestra que esté desplegado.

El árbol inspeccionado tiene un **rebase pendiente con 13 archivos en conflicto**,
incluidos `db_service.py`, `meta_service.py`, `message_outbox.py`,
`whatsapp_identity_service.py` y componentes del frontend. Las observaciones sobre
esas piezas describen código presente, no una versión ejecutable consolidada.
Esta revisión documental no resuelve ni sobrescribe los cambios del rebase.

| Supuesto anterior | Evidencia actual | Corrección |
|---|---|---|
| `db_service.py` es un monolito por separar desde cero | Hay módulos en [services/store](../backend/services/store) y una fachada en `db_service.py`, todavía en conflicto | Extender esa separación con contexto obligatorio; evitar una segunda capa paralela de repositorios |
| Auth basada en sesión/JWT | [session_service.py](../backend/services/session_service.py) usa tokens opacos, hashes, rotación, `auth_sessions` y `trusted_devices`; rechaza cookies JWT históricas | Resolver org desde sesión/usuario; no introducir JWT como requisito |
| `chat_watcher` procesa solo el último mensaje mediante una firma global | [chat_watcher.py](../backend/services/chat_watcher.py) ya pagina por `(sent_at, id)` y procesa cada mensaje | Adaptar recuperación y emisiones, sin repetir la reescritura |
| No hay abstracción de proveedor | [whatsapp_channel.py](../backend/services/whatsapp_channel.py), [whatsapp_channels.py](../backend/services/whatsapp_channels.py) y `meta_channel.py` ya definen puertos/adaptadores | Inyectar conexión y credenciales; `current_channel()` sigue siendo global |
| Embedded Signup solo está por investigar y el QR sigue disponible | Hay `/api/settings/meta/embedded-signup`, `useFacebookSdk.ts` y `WhatsappPanel.tsx`; `routers/whatsapp.py` está eliminado, pero `main.py` todavía lo importa/registra | Consolidar el rebase y adaptar el signup existente; no prometer un QR operativo |
| Evolution es necesariamente la entrada real | Existe [webhook meta cloud api.json](../webhook%20meta%20cloud%20api.json), además de `rag.json` y flujos legacy | Verificar la ruta desplegada; Meta es el destino y Evolution solo compatibilidad comprobada |
| n8n ya no escribe DB, así que basta ajustar el backend | Los cinco JSON no contienen nodos Postgres, pero transportan IDs sin contexto confiable de org | Coordinar los contratos HTTP de lectura, escritura y multimedia de n8n |
| Solo falta cambiar el UNIQUE de `wa_message_id` | Hay unicidades globales de JID legacy, catálogos, shortcuts y dedupe del outbox | Migrar restricciones y consultas juntas, con integridad entre organizaciones |
| Settings y workers se migran después del onboarding | Usan configuración/datos globales y ejecutan efectos externos | Son requisitos previos al segundo tenant |

`realtime_events.py` ya tiene enums, pero [ws_manager.py](../backend/services/ws_manager.py)
conserva conexiones en memoria por usuario y `broadcast()` es global. Los enums
no constituyen un bus entre procesos. `compose.mq.yml` configura ingesta
Evolution → n8n; no prueba que el backend distribuya eventos entre réplicas.

### 1.1 Bloqueos previos de migraciones

La inspección estática del grafo Alembic encontró dos heads:

- `c4e8a1d6f239` (`outbox_dedupe_key`).
- `c9a2e6f83d51` (`plantillas_importadas_de_meta`), con padre `6af703c8bc6c`.

[scripts/migrate.py](../backend/scripts/migrate.py) espera una única head.
`backend/migrations/031_plantillas_importadas_de_meta.sql` contradice
[migrations/README.md](../backend/migrations/README.md) y
`test_legacy_sql_migrations_frozen.py`, cuyo máximo permitido es 30.
Regularizarlo al consolidar el rebase: comprobar qué revisiones están aplicadas
por entorno. Si ambas ramas se desplegaron, usar una revisión merge y reconciliar
su DDL; si una nunca se desplegó, evaluar corregir su padre. **No reescribir una
revisión aplicada, elevar el límite del test ni ejecutar SQL 031 para sortearlo.**
Si ya se aplicó manualmente, reconciliar el esquema sin recrear columnas existentes.

`leads` y `wsp_messages` siguen excluidas de autogenerate por `EXTERNAL_TABLES`
en [alembic/env.py](../backend/alembic/env.py): requieren revisiones explícitas.
Los comentarios sobre escrituras directas de n8n son históricos; quitar el filtro
a ciegas puede proponer borrar columnas reales no mapeadas.

## 2. Invariantes

1. Toda fila de negocio tiene una organización obligatoria e inmutable. Se
   conservan UUID/bigint actuales; conocer un ID no autoriza su acceso.
2. `TenantContext` es obligatorio y procede de sesión validada, integración
   autenticada o job persistido. No de un `organization_id` elegido por el cliente.
3. Las referencias entre filas pertenecen a la misma org, incluso para admins.
   Admin de organización no es operador de plataforma.
4. No hay fallback silencioso a la org inicial, credenciales WhatsApp globales
   ni búsquedas en todas las organizaciones.
5. Jobs y eventos retienen dueño/conexión durante reintentos, pausas y rotación
   de credenciales. Suspender una org revoca acceso y detiene nuevos efectos
   externos. Los eventos entrantes se rechazan/reintentan o retienen de forma
   duradera según contrato; nunca se reasignan a otra org.
6. Las etapas preparatorias mantienen una sola org habilitada. Extraer funciones
   o añadir columnas no certifica aislamiento.

## 3. Modelo de datos

### 3.1 Organizaciones, usuarios y conexiones

Crear `organizations(id UUID, name, status, created_at, ...)` y
`users.organization_id NOT NULL`. Primera versión: un usuario pertenece a una org;
conservar email globalmente único para mantener inequívoco el login por email.
Si se necesita pertenencia múltiple, diseñar `organization_memberships` y selección
de org ligada a sesión antes de cambiar esa regla.

Crear `whatsapp_connections` con ID estable, `organization_id`, proveedor,
`phone_number_id`, `waba_id`, referencia a secreto cifrado, versión de credencial,
estado y fechas. Índice parcial: máximo una conexión activa por org. Reservar cada
`phone_number_id` a una sola org; no reasignarlo sin procedimiento explícito de
transferencia. Conservar conexiones históricas para jobs y webhooks tardíos.

Comprobar que token, WABA y número realmente corresponden y que la conexión no
pertenece a otra org. No confiar en IDs enviados por el navegador. Para esta
primera versión no compartir WABA entre organizaciones: las plantillas se gestionan
por WABA y ese caso necesita reglas adicionales. La app Meta de plataforma puede
ser compartida.

### 3.2 Inventario completo del ORM

[db/models.py](../backend/db/models.py) declara **33 tablas** en el árbol auditado.
El plan anterior usaba nombres genéricos incorrectos: `tags`, `internal_notes`,
`notifications` y `media_library`.

| Tablas actuales | Propiedad/origen para backfill |
|---|---|
| `users` | Organización inicial; roles y protección del último admin por org |
| `auth_sessions`, `trusted_devices` | Usuario; preservar hashes, rotación, expiración y revocación |
| `leads`, `whatsapp_identities`, `wsp_ad` | Lead y conexión; anuncios sin lead requieren asignación explícita |
| `wsp_messages`, `message_outbox`, `scheduled_messages` | Mensaje por lead; outbox por mensaje y lead coincidentes; programados por lead/creador |
| `lead_tags`, `lead_services`, `template_categories` | Catálogos de la org inicial, sin compartir implícitamente |
| `lead_tag_assignments`, `lead_activity`, `lead_tasks` | Lead y todos los usuarios/tags referenciados de la misma org |
| `lead_notes`, `lead_note_mentions` | Lead/nota y autor/usuario mencionado de la misma org |
| `user_notifications`, `push_subscriptions` | Destinatario/propietario; validar también referencias del payload |
| `issue_reports`, `issue_report_attachments`, `issue_report_comments`, `issue_report_events` | Reporte y actores; acceso de soporte de plataforma separado y auditado |
| `appointments` | Creador y org del flujo externo, incluidos registros fallidos o duplicados |
| `message_templates`, `template_attachments`, `template_user_state`, `media_assets` | Plantilla/creador, adjunto/asset y usuario; `visibility='global'` significa toda la org |
| `automation_rules`, `automation_flow_versions`, `automation_round_robin_state`, `automation_executions` | Regla y referencias; versiones, contadores y ejecuciones sin lead también tienen dueño |
| `app_settings` | Separar plataforma y `organization_settings`; no renombrar toda la tabla |

Añadir `organization_id` explícito a las 32 tablas distintas de `app_settings`,
incluidas hijas, para políticas y consultas verificables. La autenticación necesita
un lookup acotado anterior al contexto tenant (§4.1 y §4.7).

Inventariar además tablas, índices, funciones, triggers y columnas reales fuera del
ORM, incluidos `n8n_*`, históricos y backups. No cambiar tablas ajenas automáticamente.
Si contienen contexto activo de clientes, definir su aislamiento antes del segundo
tenant; estos JSON no auditan toda la instalación de n8n.

### 3.3 Integridad entre organizaciones

Mantener PK actuales y crear claves únicas adicionales `(organization_id, id)`
en padres. Usar FK compuestas, por ejemplo:

```text
wsp_messages(organization_id, chat_id) -> leads(organization_id, id)
lead_tasks(organization_id, assigned_user_id) -> users(organization_id, id)
lead_tag_assignments(organization_id, tag_id) -> lead_tags(organization_id, id)
message_outbox(organization_id, message_id) -> wsp_messages(organization_id, id)
```

Aplicarlo también a menciones, adjuntos, actores, plantillas, reglas, versiones,
sesiones y dispositivos. En outbox comprobar además que `message_id` y `chat_id`
identifican el mismo chat; dos FK independientes no garantizan eso. Auditar
`ON DELETE`: un `SET NULL` compuesto no debe anular `organization_id`; anular solo
la referencia opcional o usar borrado lógico según la relación.

IDs guardados en JSON (payload, acciones, condiciones, versiones de flujos,
resultados y notificaciones) no quedan protegidos por FK. Validarlos al guardar y
al ejecutar, incluyendo forward e invocación de otros flujos. Fusiones y
reasignaciones de leads nunca cruzan organizaciones.

### 3.4 Unicidades, deduplicación e índices

| Restricción actual | Cambio |
|---|---|
| `leads.remote_jid` único global | `(organization_id, remote_jid)` |
| `whatsapp_identities(instance, jid)` | `(organization_id, instance, jid)` durante compatibilidad; `instance` mapea a conexión propia y no autoriza acceso |
| `idx_wsp_messages_wa_message_id` | UNIQUE `(organization_id, wa_message_id)` manteniendo `WHERE wa_message_id IS NOT NULL` |
| `uq_message_outbox_dedupe_key` | UNIQUE `(organization_id, dedupe_key)`; adaptar inserción, conflicto y recuperación |
| Nombres de `lead_tags`, `lead_services`, `template_categories` | Unicidad por org de `name` y `lower(name)`; retirar también UNIQUE globales de columna |
| Shortcuts de `message_templates` | Global: `(organization_id, lower(shortcut))`; personal: `(organization_id, created_by_user_id, lower(shortcut))`, conservando predicados parciales |
| Plantillas oficiales | Importación/sync por org y WABA/conexión; definir dedupe por ID Meta o nombre/idioma y sanear duplicados antes de imponerlo |
| Outbox por mensaje, versión por regla y otras claves internas | Conservar unicidades basadas en IDs globalmente únicos; añadir integridad tenant |

Hashes de sesión/dispositivo, email y endpoint push no deben perder unicidad global
por sustitución mecánica. Las URLs de objetos pueden seguir siendo únicas; su
autorización depende de su dueño.

Actualizar junto al índice búsquedas por `wa_message_id`, `ON CONFLICT`, recuperación
tras `IntegrityError`, reconciliación de ecos, estados, reacciones, citas y dedupe
de lotes. `store/messages.py` hoy recupera duplicados sin org: cambiar solo el índice
haría ambigua la consulta. Separar lotes por conexión/org **antes** de deduplicar.

Incluir org en índices de listas, búsqueda, kanban, asignación y vencimientos,
conservando orden/predicados. Medir planes de consulta en copia representativa;
no duplicar todos los índices por rutina.

## 4. Adaptación de los flujos

### 4.1 Sesión, servicios y permisos

Extender `get_current_user` con `TenantContext` validando sesión, usuario y org
activos. El bootstrap solo lee por token hasheado y devuelve contexto mínimo;
no entrega una sesión SQL global reutilizable por routers de negocio.

Exigir contexto en `services/store/*` y servicios con sesiones propias: tareas,
notas, plantillas/categorías, medios, automatizaciones, outbox, programados,
settings, dashboard, citas, reportes, notificaciones/push, identidades y asignación.
Compartir sesión/unidad de trabajo para operaciones atómicas. Las pruebas actuales
con dobles no sustituyen pruebas de DB/API con dos orgs.

Filtrar lecturas, escrituras, agregados, subconsultas, joins y SQL crudo. Validar
IDs relacionados antes de mutar/enviar y responder sin revelar datos ajenos.
La protección del último admin y `lead_assignment.py` se calculan por org.
El seed `ADMIN_EMAIL`/`ADMIN_PASSWORD` queda limitado al bootstrap inicial;
no crea admins globales ni vuelve a poblar otras organizaciones.

Invalidar cachés de sesión entre réplicas al revocar usuarios, sesiones u orgs y
cerrar sus WebSocket. Cambiar de org a un usuario activo no es una edición ordinaria:
requiere revocación y revisión de relaciones.

### 4.2 Settings, credenciales y canal

Conservar `app_settings` para plataforma, con acceso exclusivo del operador:
app Meta, infraestructura, cifrado y valores explícitamente compartidos. Crear
`organization_settings` con PK `(organization_id, key)`. WhatsApp se resuelve desde
`whatsapp_connections`, con una sola fuente de verdad para número y credenciales.

Clasificar n8n, citas y ElevenLabs según contrato de producto: compartir un servicio
no permite compartir datos, destinos ni autorización. `/api/settings` no debe
exponer/modificar secretos de plataforma para un admin de org. Preservar cifrado
DB y ocultación de secretos en respuestas.

Eliminar fallback `.env` para token, WABA y número de otras orgs: importar valores
efectivos legacy **una vez** a la org inicial. Una org nueva sin conexión falla por
configuración ausente. Cachés por org/conexión/versión de credencial/clave según
corresponda, con invalidación entre réplicas; el diccionario global actual no sirve.

Reutilizar `WhatsAppChannel` mediante fábrica con contexto. El pool HTTP puede
compartirse si no muta headers/autorización globales. Cubrir envío, lectura,
reacciones, medios, plantillas e historial. `EvolutionHistoryReader` aún figura en
el canal Meta: retirarlo o acotarlo a conexiones legacy comprobadas, sin fallback
a credenciales Evolution globales para cualquier org.

El signup existente guarda hoy tres claves globales. Adaptarlo a un intento ligado
a sesión/admin/org, de uso único, resultado verificado y persistencia sin sobrescribir
otra conexión. Mantener estado pendiente hasta completar verificación/ruteo. Los
permisos reales de Meta se comprueban en el entorno; tener código no los acredita.

### 4.3 n8n, webhooks e identidad

El workflow Meta recorre `entry`, `changes`, mensajes y estados, pero **no conserva
`phone_number_id`**: el texto no aparece en el JSON actual. La identidad usa una
instancia sintética fija. `rag.json` contiene `dermicapro-business`, y callbacks de
estados/borrados carecen de contexto. Añadir columnas al backend no basta.

Definir contrato versionado con conexión, tipo/ID de evento, correlación y payload.
Preservar el `phone_number_id` original por elemento de Meta y separar lotes de
varios números. El backend resuelve org desde su registro. Eventos a nivel WABA,
como plantillas, requieren ruteo por WABA, no un número inventado.

El dato de ruteo **no autentica**. Verificar autenticidad del proveedor en la frontera
pública antes de normalizar; el handshake del webhook no autentica cada POST.
Entre n8n y backend usar credencial de integración con conexiones permitidas o
una envoltura firmada verificable. Si se conserva token compartido de orquestador,
será exclusivamente de plataforma y su permiso global será explícito; nunca se
entrega a clientes. Validar coincidencia de conexión, recurso y credencial. Eventos
sin ruteo, desconocidos o ambiguos se rechazan o retienen para revisión, sin fallback
ni éxito que los descarte silenciosamente.

Propagar contexto a todos los endpoints de `routers/webhooks/*`, incluidas lecturas
raw, identidad, ensure-lead, historial, duplicados, análisis, estado, reacciones,
outgoing, medios, etapas y callbacks tardíos. También `/api/media/upload`, sugerencias
IA y citas en ambos sentidos. Auditar `/api/public/catalog`, llamado por `rag.json`:
la URL no demuestra que exista un catálogo público tenant-aware en este backend.
Aislar memorias IA, cachés, archivos y destinos externos compartidos por org.

Conservar alias LID/JID históricos. En [whatsapp_connection.py](../backend/services/whatsapp_connection.py),
`ANY_CONNECTION='*'` y `connection_scope() == None` no pueden saltarse el filtro de
org: `*` solo abarca conexiones de esa org; conexión ausente nunca habilita búsqueda
global. Teléfono, JID e ID de mensaje no sirven para deducir una organización.

Ensayar workflows con fixtures de mensajes, estados, reacciones, medios, ecos y
reintentos. Compatibilidad sin ruteo solo durante la fase de una org, mediante
adaptador explícito ligado a la credencial inicial. Retirarlo antes del segundo
tenant y conservar la versión de workflow necesaria para revertir esa fase.

### 4.4 Jobs, automatizaciones y recuperación

Todo job lleva `organization_id`; envíos también `connection_id` estable. Reclamar
con aislamiento y `FOR UPDATE SKIP LOCKED` donde corresponda, conservando atomicidad
mensaje + outbox y leases/reintentos. Al ejecutar, revalidar org/conexión; rotar token
no permite cambiar el número de un job. Suspender conexión detiene/reprograma
pendientes explícitamente.

Para RLS: enumerador de orgs activas obtiene solo IDs; workers abren transacción
scoped y reclaman por org. No conceder `BYPASSRLS` general para recorrer una cola
global. Añadir equidad, límites por org y pruebas concurrentes.

Cubrir outbox, programados, `automation_scheduling`, `automations/*`, recordatorios,
notificaciones/push y mantenimiento. Contadores, reglas, reparto de vendedores,
esperas durables, invocaciones y reanudación retienen contexto. Recordatorios
personales exigen org y destinatario, no broadcast a toda la org.

El watcher ya procesa lotes, pero el cursor por `sent_at` vive en memoria y al
arrancar toma el último mensaje. No recupera inserciones tardías anteriores al
cursor ni trabajo omitido durante reinicio. Para acciones recuperables, persistir
evento pendiente en la transacción del mensaje y consumir con idempotencia. No
sustituir por `MAX(id)` suponiendo orden de commit. Puede conservarse polling por
org para resincronizar UI. Webhook y watcher no deben duplicar automatizaciones.

### 4.5 Tiempo real y navegador

Registrar sockets por `(organization_id, user_id, session_id)`. Extender enums con
sobre versionado (`event_id`, `organization_id`, tipo, recurso, destinatario
opcional) y publicar después del commit. Mantener outbox de mensajes para envíos;
para eventos de dominio durables usar cola/tabla separada.

Probar transporte entre réplicas. Con RabbitMQ cada réplica debe recibir eventos
para sus sockets; una cola con consumidores competidores no hace fanout a todas.
Redis pub/sub o `LISTEN/NOTIFY` requieren recuperación por consulta y no reemplazan
una cola durable. El bus en memoria solo cubre una instancia. `_wake`/`_wakeup`
son optimizaciones locales; polling/reintentos deben recuperar trabajo en otra réplica.

Claves de React Query como `['chats', ...]` y `['chat', id]` no incluyen org.
Añadirla a datos de negocio; cerrar sockets, cancelar solicitudes y limpiar estado
al salir/cambiar sesión. Revisar almacenamiento local y push en dispositivos
compartidos: respuestas tardías de A no pueden repoblar la sesión B.

### 4.6 Archivos privados

`main.py` exige sesión para `/media/{filename}`, pero `routers/media.py` busca por
nombre sin comprobar org. Bucket privado y nombres aleatorios no aíslan usuarios
autenticados de organizaciones distintas.

Registrar dueño de cada objeto: mensajes, biblioteca, adjuntos de plantillas/reportes,
TTS, uploads n8n y comprobantes. `media_assets` es biblioteca, no un inventario de
todos los archivos. Crear registro de propiedad o ampliar explícitamente el modelo,
incluidos uploads todavía sin mensaje.

Autorizar GET, HEAD, Range, descarga, reutilización, forward, borrado y lectura
interna antes de acceder a disco/MinIO. Prefijos por org para objetos nuevos;
URLs históricas mediante mapeo autorizado, sin obligar a mover archivos en el
primer despliegue. Backfill por referencias y reporte de huérfanos, sin adivinar dueño.
Cachés HTTP y URLs firmadas, si se usan, deben respetar el aislamiento/revocación.

### 4.7 RLS y pool de conexiones

Activar RLS antes del lanzamiento multi-tenant como segunda barrera. Runtime sin
superusuario, propiedad de tablas ni `BYPASSRLS`; rol de migraciones separado.
Aplicar `ENABLE` y `FORCE ROW LEVEL SECURITY` a tablas tenant con `USING` y
`WITH CHECK`. Superusuarios/BYPASSRLS eluden políticas; FK/UNICIDAD tampoco están
sujetas a RLS, por lo que siguen siendo necesarias las FK compuestas.
[PostgreSQL 16: políticas de filas](https://www.postgresql.org/docs/16/ddl-rowsecurity.html).

En cada transacción, antes de consultar negocio, usar contexto validado y
`set_config('app.current_org', :org_id, true)`: el tercer argumento limita el ajuste
a la transacción. No dejar `SET` persistente en una conexión del pool.
[Funciones de configuración](https://www.postgresql.org/docs/16/functions-admin.html).

Predicado propuesto para columna UUID:

```sql
organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
```

Sin contexto válido no hay acceso a filas; la app rechaza antes de consultar.
Cada nueva sesión/transacción lo establece de nuevo. No compartir `AsyncSession`
entre tareas concurrentes u orgs.

Bootstrap de sesión, ruteo de integración y enumeración de orgs requieren
funciones/roles acotados, mínimos y auditados, separados del acceso de negocio.
No crear política global permisiva para arreglar login ni conceder bypass a todo
el backend. RLS con contexto establecido por la app cubre consultas olvidadas,
no una app comprometida que puede elegir deliberadamente otro contexto.

## 5. Secuencia y condiciones de salida

Las etapas 1–5 mantienen una sola org en producción; no son multi-tenant parcial.

| Etapa | Entrega | Condición para continuar |
|---|---|---|
| 0. Consolidar base | Resolver rebase en su trabajo correspondiente, regularizar Alembic/SQL 031, inventariar esquema y workflows reales | Sin conflictos, una head, checks backend/frontend pasan y backup restaurado en ensayo |
| 1. Expandir | Organizaciones, conexiones, settings por org, columnas nullable y `TenantContext` sobre capas actuales | Release de compatibilidad que opera la org inicial y escribe dueño en datos nuevos |
| 2. Backfill y contratos | Históricos, propiedad de archivos, nuevas FK/índices y contratos n8n/Meta | Sin filas sin dueño ni referencias cruzadas; conteos conciliados y ruteo inequívoco |
| 3. Aislamiento completo | API, servicios, sesión, settings/canales, archivos, navegador, jobs y eventos | Dos orgs en pruebas sin lecturas, escrituras, envíos o notificaciones cruzadas |
| 4. Endurecer | NOT NULL, unicidades tenant, RLS y retiro de fallbacks | Sin contexto falla; rol real y pool reutilizado pasan pruebas |
| 5. Ensayo operativo | Blue-green, fanout, recuperación, latencia y reversión | Versiones de la ventana compatibles; sin procesos antiguos sin scope |
| 6. Piloto | Segunda org y signup adaptado | Criterios §7 completos; monitoreo por org y rollback tenant-aware |
| 7. Autoservicio | Registro, invitaciones, planes, límites y billing | Alta/baja idempotentes sin romper aislamiento ni pendientes |

### 5.1 Expandir → rellenar → restringir

1. **Ensayar con copia restaurada**, revisión Alembic, distribución de filas,
   volumen, índices y multimedia. Confirmar pertenencia a la org inicial; un
   nombre de instancia no prueba propiedad si hay varias fuentes históricas.
2. **Expandir con Alembic**: UUID inicial estable, creación idempotente, tablas
   nuevas y columnas nullable. No SQL manual de `backend/migrations/` ni fijar
   revisión padre antes de cerrar etapa 0.
3. **Cubrir escrituras concurrentes** de API, workers y workflows. Mientras
   conviva código anterior, usar mantenimiento o default/trigger temporal limitado
   a la org inicial. Debe retirarse antes de la segunda org. Nullable por sí solo
   no cubre escrituras viejas.
4. **Backfill reanudable por lotes**, padres primero y después hijos. Derivar org,
   comparar todos los padres y detenerse ante discrepancias. Asignar explícitamente
   filas sin padre y settings. Actualizar pendientes y registrar progreso/conteos/
   errores sin secretos. Evitar transacción masiva sobre mensajes.
5. **Construir/validar índices y FK** antes de retirar los anteriores. Prever locks,
   `lock_timeout`, espacio y recuperación. En tablas grandes evaluar índices
   concurrentes: `CREATE INDEX CONCURRENTLY` no funciona dentro de transacción y
   puede dejar índice inválido al fallar. El runner usa `engine.begin()` con
   advisory lock: diseñar/probar esa frontera transaccional y conservar exclusión
   entre migradores antes de incluir tal DDL.
   [CREATE INDEX en PostgreSQL 16](https://www.postgresql.org/docs/16/sql-createindex.html).
6. **Conciliar con tráfico nuevo**: segunda pasada de nulos, conteos por tabla/org,
   relaciones, jobs activos/pausados/fallidos, medios y payloads históricos.
   Aplicar NOT NULL, FK validadas y políticas.
7. **Retirar compatibilidad**: unicidades globales de negocio, fallbacks, defaults
   temporales y productores anteriores. Actualizar dedupe antes de permitir
   colisiones entre orgs. Probar upgrade, instalación nueva y reanudación.

### 5.2 Blue-green y reversión

[deploy-bluegreen.sh](../scripts/deploy-bluegreen.sh) migra la DB compartida antes
de levantar el color nuevo. El swap **no revierte esquema**; el color viejo puede
seguir ejecutando jobs. Código sin scope no puede coexistir con datos de una
segunda org.

Durante expansión solo se vuelve a la release de compatibilidad probada con una
org y esquema expandido. Antes de endurecer columnas/retirar índices, verificar
ambas versiones de la ventana. Antes del piloto, drenar/detener procesos viejos,
incluidos workers, y dejar como versión anterior una release con aislamiento completo.

Después de crear la segunda org, **prohibido volver al binario single-tenant** o
eliminar `organization_id` mediante downgrade. Ante incidente: deshabilitar altas
y efectos externos afectados, conservar jobs/eventos y corregir o volver a una
release tenant-aware compatible. Restauración de backup es recuperación de desastre
coordinada con replay posterior; puede perder escrituras recientes y no es rollback
ordinario. Ensayarla antes del corte.

## 6. Pruebas de aceptación

Usar PostgreSQL 16, familia configurada en `compose.db.yml`, dos orgs A/B,
credenciales ficticias distintas y claves externas iguales deliberadamente.
Dobles de proveedor evitan WhatsApps reales; integración real comprueba SQL, FK,
RLS, concurrencia y rutas. Ampliar tests existentes de auth, n8n, identidad, dedupe,
outbox, medios, watcher y arquitectura.

| Caso | Resultado exigido |
|---|---|
| Mismo teléfono/JID, `wa_message_id`, tag y shortcut en A/B | Independientes; retry en A deduplica solo A |
| Usuario A lee/modifica ID de B, incluidos raw, búsqueda y dashboard | Sin datos, cambios, conteos ni confirmación de existencia de B |
| Vendedor, tag, mención, adjunto, plantilla o regla de B asignados a A | Rechazo de servicio y DB para relaciones con FK |
| Borrados en cascada/SET NULL | Mantienen dueño y afectan solo filas autorizadas |
| Header/body manipulado, conexión desconocida o lote mixto | Auth/ruteo por elemento, sin fallback ni dedupe cruzado |
| Estado, reacción, cita o callback IA tardío | Solo mensaje/lead y conexión originales |
| Jobs paralelos, retry, pausa y rotación de token | Mismo dueño/número, sin mezcla de credenciales ni jobs cruzados |
| Dos réplicas y sockets en ambas | Solo org destinataria; eventos personales solo al usuario; recuperación tras caída |
| GET/HEAD/Range, forward o borrado del archivo de B por A | Sin bytes ni metadatos privados |
| Logout A → login B con fetch en vuelo y push compartido | Sin datos, eventos o notificaciones de A en B |
| Revocación de sesión/PIN o suspensión de org | Sin HTTP/WS ni nuevos envíos, incluso con caché en otra réplica |
| SQL sin WHERE tenant y secuencia A → B → sin contexto en una conexión | RLS bloquea cruce y ausencia de contexto; pool no conserva org anterior |
| Backfill interrumpido con escrituras concurrentes | Reanudable, sin nulos residuales, cruce o pérdida de mensajes |
| Upgrade, instalación limpia y rollback blue-green | Una head, conteos conciliados, versiones compatibles y ningún worker viejo |

## 7. Criterio para habilitar la segunda organización

- [ ] Rebase resuelto, una head y política de SQL histórico respetada.
- [ ] Esquema real conciliado con las 33 tablas ORM y objetos adicionales.
- [ ] Backfill completo, restricciones validadas y ningún default de tenant inicial.
- [ ] API, sesión, settings, canales y archivos exigen contexto autorizado.
- [ ] Workflows activos/callbacks conservan ruteo autenticado, sin fallback legacy.
- [ ] Jobs, medios, IA, eventos, cachés y push pasan los casos cruzados de §6.
- [ ] RLS probado con rol runtime y reutilización real del pool.
- [ ] Signup guarda/verifica únicamente la conexión de su org.
- [ ] Transporte entre réplicas y recuperación ensayados; procesos viejos retirados.
- [ ] Backup restaurado y rollback a release tenant-aware comprobados.

El siguiente paso de implementación es **cerrar etapa 0** y preparar la release
de compatibilidad, aprovechando las capas actuales. No hay que reconstruir desde
cero repositorios, watcher ni Embedded Signup.

## 8. Verificación realizada en esta revisión

- Inventario obtenido del AST de `db/models.py`: 33/33 tablas incluidas.
- Grafo leído de las revisiones Alembic: dos heads, sin padres inexistentes.
- Workflows inspeccionados: `rag.json`, `webhook meta cloud api.json`,
  `webhook msg update.json`, `webhook msg deleted.json` y `Webhooks evolution.json`.
- Enlaces locales del documento comprobados y `git diff --check` sin errores.
- Control de SQL histórico ejecutado aisladamente: falla por el archivo 031,
  condición preexistente descrita en §1.1.
- No se ejecutaron migraciones, llamadas a proveedores ni la suite completa sobre
  el árbol con conflictos. Las pruebas de §6 son criterios pendientes de la
  implementación, no resultados de esta revisión documental.
