# sugerencias-chat

Para contribuir: [mapa de arquitectura](docs/arquitectura-modular.md),
[guía para agregar una funcionalidad](docs/guia-nueva-funcionalidad.md) y
[plan de refactorización](docs/plan-refactor-arquitectura-modular.md).

## Despliegue en producción (con Traefik)

Requiere Docker y el plugin Docker Compose. El dominio debe apuntar (registro A) a la IP del servidor antes de levantar el proxy, para que el challenge HTTP-01 de Let's Encrypt funcione.

### 1. Variables de entorno

```bash
cp backend/.env.example backend/.env      # completar DATABASE_URL, N8N_WEBHOOK_URL, etc.
cp traefik/.env.example traefik/.env      # completar ACME_EMAIL
```

`DATABASE_URL` y `CORS_ORIGINS` solo se configuran acá (son necesarios para que la app arranque). El resto de las claves de servicios externos (n8n, Meta, ElevenLabs) se pueden completar en este archivo como semilla inicial, pero también se pueden cargar y editar después desde la propia app: ícono de engranaje ⚙️ en la barra superior → "Configuración" (solo visible para usuarios admin). Lo que se guarde ahí desde la UI tiene prioridad sobre el `.env`.

**Primer login:** la app requiere iniciar sesión. Para crear la primera cuenta (admin), completá `SECRET_KEY` (generarla con `openssl rand -hex 32`), `ADMIN_EMAIL` y `ADMIN_PASSWORD` en `backend/.env` antes de levantar el backend por primera vez — se crea automáticamente al arrancar si la tabla `users` está vacía. Después de loguearte podés borrar `ADMIN_PASSWORD` del archivo (no se vuelve a leer una vez que existe algún usuario). Desde "Configuración → Usuarios" el admin invita al resto del equipo por correo; cada persona crea su propia contraseña desde un enlace de un solo uso.

**Correo transaccional:** configurá `SMTP_HOST`, `EMAIL_FROM_ADDRESS` y las
credenciales correspondientes en `backend/.env`. En una instalación
single-tenant también es obligatorio `APP_PUBLIC_URL`; en multitenancy los
enlaces usan el dominio registrado de cada negocio. Sin SMTP, la app rechaza
la creación de invitaciones y omite de forma segura recuperaciones y avisos
operativos. Los enlaces de invitación y recuperación expiran y solo pueden
usarse una vez.

**Citas y Google Calendar:** las citas se guardan primero en PostgreSQL y no
dependen de n8n. La sincronización con Google es opcional y se activa desde
"Configuración → Google Calendar" con Calendar ID, OAuth Client ID, Client
Secret y Refresh Token; los secretos se almacenan cifrados. Si Google o n8n
fallan, la cita local se conserva y el historial muestra el estado de la
integración.

El login ofrece **Recordar este dispositivo**. La sesión se renueva por actividad
durante 30 días, tiene un máximo absoluto de 90 días y puede revocarse por
dispositivo desde el escudo **Acceso y seguridad**. Allí cada usuario puede
crear un PIN de 4 dígitos: el PIN sólo funciona junto con el token secreto de
ese navegador, se bloquea temporalmente después de 5 intentos fallidos y nunca
reemplaza la contraseña para registrar un dispositivo nuevo. Restablecer la
contraseña o desactivar un usuario revoca todas sus sesiones y dispositivos.

**Cifrado de configuración:** definí también `SETTINGS_ENCRYPTION_KEY` con una
clave base64-url aleatoria de 32 bytes (el comando de generación está en
`backend/.env.example`). Los tokens y API keys escritos en `app_settings` se
guardan con AES-GCM autenticado, permanecen enmascarados en la API y solo se
descifran dentro del backend. URLs, IDs y parámetros operativos se conservan
en texto plano para que la UI y las integraciones externas puedan utilizarlos.
Al arrancar, el backend normaliza automáticamente las filas históricas según
esta política. Guardá una copia segura de la clave fuera de PostgreSQL:
perderla impide recuperar los valores secretos.

### 2. Reverse proxy (Traefik)

Se levanta una sola vez por servidor; es compartido entre proyectos que enruten por dominio.

```bash
docker compose -f traefik/reverse-proxy.docker-compose.yml --env-file traefik/.env up -d
```

### 3. Base de datos

PostgreSQL vive en el propio proyecto, en su propio archivo de compose y con su propio ciclo de vida. Se levanta **una vez por servidor**, antes que la aplicación:

```bash
cp db/.env.example db/.env      # poner POSTGRES_PASSWORD: openssl rand -base64 32
docker compose -f compose.db.yml --env-file db/.env up -d
```

Va aparte de `compose.prod.yml` por dos motivos. El despliegue blue-green levanta la aplicación como dos proyectos distintos: si la base estuviera dentro, cada color arrancaría la suya y el tráfico saltaría entre dos conjuntos de datos. Y separando el ciclo de vida, ningún `down` de la aplicación puede tocar los datos.

**Por defecto no publica ningún puerto.** La aplicación y un n8n en esta misma máquina se llegan por la red `dermicapro-data`:

```bash
docker network connect dermicapro-data <contenedor-de-n8n>
```

En `backend/.env`, la conexión de la app es siempre interna y **en claro**:

```
DATABASE_URL=postgresql+asyncpg://dermicapro:<password>@postgres:5432/dermicapro_db
DATABASE_SSL=require
```

`require` y no `disable`: `db/pg_hba.conf` exige cifrado a **toda** conexión de red, también a la de la app. Eximir a la red interna por su rango parece razonable, pero según cómo Docker publique el puerto una conexión externa llega con la dirección de la puerta de enlace de esa misma red y entraría sin cifrar por esa exención — comprobado. El certificado es autofirmado, así que `require` (cifra sin validar la CA) es lo que corresponde.

#### Acceso externo con TLS (n8n en otra VPS)

Si n8n corre en otra máquina y no hay red privada entre las VPS, hay que publicar el puerto 5432 y **exigir TLS** desde fuera (`db/pg_hba.conf`: `hostssl` obligatorio, `hostnossl` rechazado). El bind se controla en `db/.env`:

```
POSTGRES_BIND_IP=10.0.0.5     # IP PRIVADA de este host; 0.0.0.0 expone a Internet
POSTGRES_PUBLISH_PORT=5432
```

Con `ssl=on`, **Postgres no arranca sin certificado**. `db/tls/` está en `.gitignore` (la clave privada no se versiona), así que en cada servidor hay que generarlo **antes** del `up -d`:

```bash
scripts/gen-db-tls.sh            # autodetecta el host; deja el par en db/tls/
```

El script crea un certificado auto-firmado en `db/tls/server.crt` y `db/tls/server.key` con el owner (`70:70`, el usuario postgres de la imagen alpine) y permisos (`600` en la clave) que Postgres exige. Es idempotente: si ya existen no los toca; usa `--force` para regenerar.

**El host es opcional.** Solo fija el CN/SAN del certificado, que únicamente comprueban los clientes con `sslmode=verify-full`. Si no lo pasas, se autodetecta la IP pública y, si no hay salida a Internet, se usa el hostname de la máquina como respaldo con un aviso — el TLS cifra igual. Pásalo solo si quieres un CN concreto:

```bash
scripts/gen-db-tls.sh 10.0.0.5           # o un dominio
scripts/gen-db-tls.sh --force 10.0.0.5   # regenerar
```

n8n conecta con `sslmode=require` (cifra sin verificar la CA, así que el auto-firmado vale). Si regeneras el certificado con la base ya en marcha, recárgalo:

```bash
docker compose -f compose.db.yml --env-file db/.env restart postgres
```

Nota: `restart` corta las conexiones un instante. Si solo cambiaste el certificado, basta recargar sin reiniciar: `docker exec <contenedor-postgres> psql -U <user> -d <db> -c 'select pg_reload_conf()'`.

#### Conectarse a la base de producción

Las credenciales (`usuario`, `contraseña`, `nombre de la base`) salen siempre de `db/.env` — es la única fuente. Los ejemplos usan un contenedor cliente `psql` para no depender de tener el binario instalado; con un `psql` local o una GUI (DBeaver, TablePlus…) los parámetros son los mismos.

**A) Base de producción, desde tu máquina.** Va por Internet, así que `db/pg_hba.conf` **exige TLS** (`hostssl`; una conexión sin cifrar se rechaza). Basta con `sslmode=require`:

```bash
docker run --rm -it -e PGPASSWORD=<password> postgres:16-alpine \
  psql "host=<IP-del-servidor> port=5432 dbname=<db> user=<user> sslmode=require"
```

Para que una app apunte a producción:

```
DATABASE_URL=postgresql+asyncpg://<user>:<password>@<IP-del-servidor>:5432/<db>
DATABASE_SSL=require
```

Comprobar que la sesión va cifrada, ya dentro de `psql`:

```sql
select ssl, version, cipher from pg_stat_ssl where pid = pg_backend_pid();
--  t | TLSv1.3 | TLS_AES_256_GCM_SHA384
```

Si además quieres verificar la identidad del servidor (no solo cifrar), cópiate `db/tls/server.crt` del servidor y usa `sslmode=verify-full sslrootcert=/ruta/server.crt`; el `host` debe coincidir con el CN/SAN del certificado (la IP pública, y también valen `localhost`/`127.0.0.1` desde el propio servidor). En una GUI: modo SSL `require`, o `verify-full` cargando ese `.crt` como CA raíz.

⚠️ Conectado a producción tocas **datos reales**: cualquier `UPDATE`/`DELETE` es inmediato y sin red de seguridad. Para experimentos, restaura un backup en local (`scripts/db-backup.sh`).

**B) Desde el propio servidor.** La app en Docker llega por `postgres:5432`, también cifrada. Para probar el TLS desde el servidor mismo, usa el comando de (A) con `host=127.0.0.1` y `--network host` (con `127.0.0.1`, no `localhost`: el puerto se publica solo en IPv4 y `localhost` intenta antes `::1`, que da *connection refused*).

#### Acceso desde n8n (otra VPS)

n8n corre en un servidor distinto y Hostinger no ofrece red privada entre VPS. La base se alcanza por un túnel WireGuard, que cifra el tráfico y permite que PostgreSQL escuche sólo en la interfaz del túnel — sin exposición pública. Ver [docs/red-privada-wireguard.md](docs/red-privada-wireguard.md).

#### Copias de seguridad

```bash
scripts/db-backup.sh              # crea y verifica un backup, poda los antiguos
scripts/db-backup.sh --restore db/backups/dermicapro-AAAAMMDD-HHMMSS.dump
```

A diario por cron:

```
0 3 * * * cd /root/sugerencias-chat && scripts/db-backup.sh >> db/backups/cron.log 2>&1
```

Los backups se escriben en `db/backups/` del host, no dentro del volumen. **Cópialos fuera del servidor**: un backup que vive en la misma máquina que los datos no protege de perder la máquina.

### 4. Aplicación

`compose.prod.yml` no se modifica: las labels de Traefik y la eliminación del bind directo al puerto 80 se aplican como override desde `traefik/docker-compose.yml`.

```bash
docker compose -f compose.prod.yml -f traefik/docker-compose.yml up -d --build
```

La app queda expuesta en `https://chat.dermicapro.app` (ajustar el `Host` en `traefik/docker-compose.yml` si el dominio cambia).

Las migraciones **no** las aplica la aplicación al arrancar. Se ejecutan antes, en un contenedor aparte:

```bash
docker compose -f compose.prod.yml -f traefik/docker-compose.yml \
  run --rm --no-deps backend python -m scripts.migrate
```

Toma un advisory lock de PostgreSQL, así que es seguro aunque se lance más de una vez a la vez. Sobre una base que ya tiene el esquema y no conoce Alembic, la marca (`stamp`) en la baseline en lugar de intentar recrearla. Con `--check` sólo informa, sin modificar nada.

Alembic es la única fuente del esquema. Los `.sql` de `backend/migrations/` que se citan más abajo son históricos: **no se aplican a mano ni se agregan nuevos** (ver `backend/migrations/README.md`). Todo cambio de esquema va como revisión en `backend/alembic/versions/`.

### 5. Despliegue blue-green (opcional)

Alternativa a los pasos anteriores para desplegar **sin corte**. La versión nueva se levanta al lado de la que sirve, se migra y se comprueba mientras nadie la usa; sólo entonces se conmuta el tráfico reescribiendo `traefik/dynamic/active.yml`, que Traefik relee en caliente.

No se combina con `traefik/docker-compose.yml`: aquel enruta por etiquetas de Docker y este por el archivo dinámico, y ambos reclamarían el mismo `Host`. Como Traefik tiene los dos proveedores activos, el router por etiquetas gana y sirve él pase lo que pase en `active.yml`: el despliegue construye, migra y conmuta de color sin que nadie vea la versión nueva. Por eso el script para el proyecto heredado (`sugerencias-chat`, sin sufijo de color) antes de dar el despliegue por bueno, y comprueba que lo que Traefik devuelve es byte a byte lo que sirve el color recién desplegado, no sólo que responde 200.

```bash
scripts/deploy-bluegreen.sh            # despliega el color inactivo y conmuta
scripts/deploy-bluegreen.sh --status   # qué color está sirviendo
scripts/deploy-bluegreen.sh --rollback # vuelve al color anterior
```

Cada color publica su nginx sólo en `127.0.0.1` (blue 8081, green 8082), de modo que únicamente Traefik llega a ellos y nadie puede saltarse el TLS entrando por el puerto de un color.

**Requisito de las migraciones:** durante la ventana en que ambos colores están vivos, el esquema sirve a los dos. Las migraciones deben ser aditivas — expandir ahora, contraer en un despliegue posterior. Un `DROP COLUMN` en la misma versión que deja de usar esa columna rompe al color viejo mientras se apaga.

Para revertir de urgencia sin el script: cambiar el puerto de la línea `url` en `traefik/dynamic/active.yml` por el del otro color. Traefik conmuta en menos de un segundo, sin reconstruir nada.

### Desarrollo local

```bash
docker compose up -d --build
```

Usa `compose.yml` (no el `.prod.yml`), con hot-reload y puertos locales:

- frontend: `http://localhost:5174`;
- backend: `http://localhost:8000`;
- PostgreSQL: `127.0.0.1:5433` para herramientas del host, y
  `postgres:5432` para el backend.

La base local guarda sus datos en el volumen `sugerencias-chat_pgdata-local` y
no se elimina al recrear los contenedores. El backend espera el healthcheck de
PostgreSQL y ejecuta `python -m scripts.migrate` antes de iniciar Uvicorn, por
lo que también prepara automáticamente una base vacía.

`db/.env` define `POSTGRES_USER`, `POSTGRES_PASSWORD` y `POSTGRES_DB`.
`backend/.env` debe usar esos mismos valores en:

```
DATABASE_URL=postgresql+asyncpg://<user>:<password>@postgres:5432/<db>
```

Compose fuerza `DATABASE_SSL=disable` únicamente para este entorno local. Los
despliegues con `compose.prod.yml` conservan `DATABASE_SSL=require` y la base
separada descrita arriba.

### Integración con Meta WhatsApp Cloud API

El contrato completo (tipos, subtipos, estados y decisiones) está en
[docs/refactor-integracion-meta-cloud-api-nativa.md](docs/refactor-integracion-meta-cloud-api-nativa.md)
y la lista de tipos vive en `backend/contracts/meta_messages.json`.

**Webhook.** En la app de Meta se registra
`https://<dominio del backend>/api/webhooks/meta/whatsapp` con el verify token
del panel de plataforma. El backend verifica la firma `X-Hub-Signature-256`,
guarda cada `change` sin tocarlo en `public.webhook_inbox`, responde 200 y un
worker lo procesa: resuelve el negocio por `phone_number_id` (o por la WABA en
los cambios de plantillas), guarda el mensaje con su `type` y subtipo
literales y el objeto completo en `provider_payload`, baja los adjuntos y
dispara las automatizaciones. Un reintento de Meta se descarta por el hash del
cambio y por el `wa_message_id` único. Si n8n tiene que quedar delante, el
workflow `meta-cloud-api` es un relay que reenvía cuerpo y firma sin
modificarlos.

**Identidad.** Un contacto se identifica con los valores exactos de Meta:
`wa_id` (su teléfono) y `user_id` (identificador por negocio), en
`whatsapp_identities`. Cualquiera de los dos resuelve al mismo lead.

**Estados.** `outbox_status` describe la cola propia (`queued`, `sending`,
`sent`, `retryable_failed`, `failed`, `discarded`) y `meta_status` el valor
literal que informa Meta (`sent`, `delivered`, `read`, `failed`), con el evento
completo en `status_payload`. Cada estado y cada reacción se guardan como
evento en `whatsapp_message_events`, así una entrega repetida o fuera de orden
no deja el mensaje en un estado que Meta nunca informó. Al abrir un chat, el
frontend llama `POST /api/chats/{chat_id}/read` y el backend marca como leídos
en Meta los mensajes pendientes del cliente.

**Salida.** Todo envío arma el cuerpo de Meta con `app/integrations/meta/outbound.py` y
se valida contra la allowlist del contrato al encolar (422 si Meta no lo
acepta) y otra vez en el worker. Los adjuntos se suben a Meta recién al enviar
y `provider_payload` guarda el cuerpo exacto que salió. Productos, catálogo,
Flows y el pedido de permiso de llamada solo se ofrecen si la cuenta los tiene
configurados (`meta_catalog_id`, `meta_published_flow_ids`,
`meta_call_permission_enabled`).

**Citas.** Responder a un mensaje manda `context.message_id` con el
`wa_message_id` del citado; las respuestas del cliente llegan con
`context.id` y se guardan en `quoted_wa_message_id`. Solo se pueden citar
mensajes que ya existen en WhatsApp: sobre uno todavía en la outbox la API
responde 409.

Meta Cloud API no permite editar ni eliminar un mensaje enviado, así que el CRM
no lo ofrece. Los mensajes eliminados antes de la migración conservan su
lápida (`deleted_at`).

### Búsqueda estilo WhatsApp

La búsqueda de la lista de leads y del Kanban ignora acentos ("jose" encuentra
"José"), busca en todo el historial de mensajes del chat (no solo en el
último), y matchea teléfonos por dígitos sin importar el formato guardado
("1112345678" encuentra "+54 9 11 1234-5678"). Los caracteres `%` y `_` se
buscan como texto literal. El backend habilita las extensiones `unaccent` y
`pg_trgm` de forma idempotente al arrancar; si el usuario de la base no tiene
permisos para crear extensiones, la búsqueda degrada a sensible a acentos y
queda `backend/migrations/020_search_unaccent.sql` para aplicar manualmente
con un superusuario.

### Etiquetas, filtros e historial de cambios

La lista de leads permite combinar búsqueda, no leídos, etapas, etiquetas
(`cualquiera` o `todas`), servicio, vendedor, origen, último emisor e inactividad.
Las consultas mantienen la paginación por cursor y aplican los filtros en PostgreSQL.
También puede filtrarse por leads que esperan respuesta: todos, menos de 10
minutos, entre 10 minutos y 1 hora, o más de 1 hora. Estos rangos usan los
mismos umbrales y el mismo último mensaje que el indicador visual de la lista.

Los administradores pueden crear etiquetas desde el panel derecho de un lead;
todos los usuarios autenticados pueden asignarlas o quitarlas. Los cambios de
estado, datos y etiquetas se guardan en `lead_activity` con actor, valores anterior
y nuevo, fecha y, para el agente IA, confianza y motivo.

Las tablas las crea Alembic (`python -m scripts.migrate`). El SQL original, hoy
solo histórico, es:

```text
backend/migrations/001_lead_tags_activity.sql
```

Las tablas `lead_tags`, `lead_tag_assignments` y `lead_activity` tienen RLS
habilitado y se consumen exclusivamente a través del backend autenticado.

### Etapas del embudo por negocio

Cada negocio administra sus etapas en **Catálogos › Etapas** (solo admin):
nombre visible, orden, color, tipo y el criterio que usa el analista IA, además
de crear etapas propias. Todo negocio nace con las 13 etapas de siempre
(`nuevo`, `en_diagnostico`, ... `baja`).

- La **clave** (`lead_stages.key`) nace del nombre y no cambia al renombrar: es
  lo que guardan `leads.estado`, las automatizaciones, las plantillas y el
  historial. Por eso renombrar no mueve leads ni rompe reglas guardadas.
- El **tipo** es la semántica que usa el código: `open` (en curso), `won`
  (ganada) o `lost` (perdida). Al mover un lead a una etapa `lost` se pide la
  razón de pérdida, sea `perdido` o una etapa propia.
- Una etapa **en uso** (leads, automatizaciones o plantillas) no se elimina: se
  desactiva. Deja de ofrecerse como destino, pero sus leads siguen visibles en
  el embudo. `nuevo` es la etapa inicial y no se puede borrar ni desactivar.
- El workflow `analista` recibe las etapas activas del negocio en
  `GET /api/webhooks/analysis-context` (`stages`) y el backend rechaza una clave
  que el negocio no tenga activa.

### Seguimientos, tareas y plantillas

Cada lead puede tener varias tareas pendientes; el panel derecho muestra como
"Próxima acción" la que vence primero. La vista `Tareas` agrupa las acciones
vencidas, de hoy y próximas. Los administradores gestionan plantillas y los
vendedores las insertan, con variables resueltas, desde el compositor del chat.

El backend crea las tablas al iniciar. Para una aplicación explícita está
disponible `backend/migrations/002_tasks_templates.sql`.

### Asignación estructurada de vendedores

Los leads se asignan mediante `vendedor_id`, relacionado con `users.id`; los
formularios y filtros utilizan usuarios activos en lugar de nombres libres.
Al iniciar se vinculan automáticamente los valores históricos de `vendedor`
que coincidan de forma única con el nombre de un usuario. La migración manual
equivalente está en `backend/migrations/004_structured_seller.sql`.

### Dashboard CRM

Los administradores disponen de un dashboard para periodos de 7, 30 o 90
días con leads nuevos, pendientes de respuesta, tareas vencidas/completadas,
tiempo medio de respuesta y distribuciones por etapa, origen, servicio y
vendedor. Los datos se actualizan por WebSocket y mediante refresco periódico.

### Respuestas rápidas personales

Además de los atajos `/`, cada usuario puede marcar plantillas favoritas,
consultar las usadas recientemente, reutilizar sus últimos mensajes enviados y
guardar un mensaje como plantilla personal. Los favoritos y el historial de
uso son independientes por usuario; las plantillas personales no son visibles
para el resto del equipo. La migración explícita está en
`backend/migrations/005_quick_replies.sql`.

Las plantillas globales también pueden incluir hasta diez imágenes, videos,
audios o documentos de 25 MB cada uno. El chat presenta una vista previa y
solicita confirmación antes de enviar el texto y los archivos en secuencia por
Meta. La migración explícita está en
`backend/migrations/006_template_attachments.sql`.

La confirmación utiliza una vista previa completa en dos paneles: permite
editar el texto ya personalizado, detecta variables `{{...}}` sin resolver,
enumera el orden real de envío y simula las burbujas que recibirá el contacto.
Las imágenes pueden ampliarse, los videos y audios reproducirse y los
documentos abrirse antes de confirmar.

### Biblioteca central de archivos

La vista administrativa `Archivos` centraliza imágenes, videos, audios y
documentos reutilizables. Admite búsqueda, filtros, vista previa y carga
múltiple mediante selector o drag-and-drop. Al cargar un adjunto desde una
plantilla también se incorpora automáticamente a la biblioteca. Desde el
editor puede elegirse un archivo existente sin crear otra copia física.

Los archivos vinculados a plantillas no pueden eliminarse hasta retirar esas
referencias. Los adjuntos históricos se registran automáticamente al iniciar;
la migración equivalente está en `backend/migrations/007_media_library.sql`.

### Notas internas y menciones

Desde el compositor de cada conversación se puede cambiar de "Mensaje de
WhatsApp" a "Nota interna". Estas notas aparecen en la línea de tiempo con un
estilo diferenciado y nunca se envían a WhatsApp. Al escribir `@` se
muestran los usuarios activos del CRM para mencionarlos.

Las menciones generan un aviso dentro del CRM y, cuando está permitido, una
notificación del navegador. Permanecen pendientes si el usuario está
desconectado y se vuelven a entregar al conectarse hasta que abra el lead. Solo
el autor o un administrador pueden editar o eliminar una nota. Los cambios
también quedan registrados en la actividad del lead. La migración explícita
está en `backend/migrations/008_internal_notes_mentions.sql`.

La campana del encabezado abre un historial persistente de menciones con
contador de pendientes, filtros para ver todas o solo las no leídas, paginación
y acciones para marcar una o todas. Abrir una notificación navega al lead; el
historial se conserva aunque la nota original se elimine. También desde esta
bandeja se activan los avisos opcionales del navegador. La tabla y el backfill
de menciones existentes están en `backend/migrations/009_notification_history.sql`.

### Ventana de atención de WhatsApp

El CRM calcula la ventana de 24 horas exclusivamente desde el último mensaje
entrante del cliente; los mensajes del vendedor no reinician el plazo. El
encabezado del chat muestra una cuenta regresiva, cambia de color al acercarse
el vencimiento y la lista de conversaciones identifica con un candado las
ventanas cerradas.

Cuando la ventana está cerrada se deshabilitan texto, audio, archivos,
ubicación y plantillas internas. El backend repite esa validación en cada ruta
de envío, por lo que el bloqueo no depende de la interfaz. Las notas internas
continúan disponibles. Para contactar nuevamente al cliente se utiliza una
plantilla oficial aprobada.

### Plantillas internas y oficiales

El editor distingue entre plantillas internas del CRM y plantillas oficiales
de Meta. Las oficiales guardan el nombre exacto registrado en Meta, idioma,
categoría, estado de aprobación y el mapeo de cada variable numérica (`{{1}}`,
`{{2}}`, ...) hacia variables del CRM como `{{nombre}}` o `{{servicio}}`.

Con la ventana cerrada, el selector del chat oculta respuestas internas y
muestra únicamente plantillas oficiales con estado `APPROVED`. El cuerpo
aprobado no puede editarse durante el envío; solo pueden ajustarse sus valores.
El backend las envía como `type: "template"` de Meta y vuelve a comprobar tipo,
estado y cantidad de parámetros. La migración correspondiente está en
`backend/migrations/010_official_templates.sql`.

### Botones y listas interactivas

Las plantillas internas pueden enviarse como texto normal o como mensaje
interactivo de Meta: `button` (hasta tres botones de respuesta) o `list`
(varias secciones y hasta diez opciones con IDs únicos). La configuración se
guarda con la estructura nativa de Meta (`header`, `footer`, `action`). Un
interactivo suelto de Meta no admite botones de URL, llamada o copiar código:
esos quedan para las plantillas oficiales.

El editor configura la estructura, la vista previa simula la tarjeta y el
desplegable de WhatsApp, y el backend vuelve a validar los límites del
contrato antes de encolar. Las variables del CRM también se resuelven en
títulos, pies, botones, secciones y opciones.
Estos mensajes requieren que la ventana de atención esté abierta. La migración
correspondiente está en `backend/migrations/011_interactive_templates.sql`.

### Envío asíncrono y diagnóstico de latencia

Los mensajes se registran primero con `outbox_status = queued` junto con una
fila durable en `message_outbox`. El request HTTP responde sin esperar a Meta;
un worker integrado los envía en segundo plano, conserva el orden por chat y
hace hasta tres intentos antes de marcar el envío como `failed`. Esto no
requiere RabbitMQ para el volumen actual y evita perder trabajos si el backend
se reinicia. La migración manual equivalente está en
`backend/migrations/017_message_outbox.sql`.

Desde el panel de un lead también puede programarse un texto para una fecha y
hora futuras. El registro permanece en `scheduled_messages` y puede cancelarse
mientras siga programado. Al vencer, el worker comprueba la ventana de atención
de 24 horas y recién entonces encola el mensaje y su trabajo de outbox.
La vista muestra si quedó programado, está enviándose, fue enviado o falló. La
migración manual está en `backend/migrations/018_scheduled_messages.sql`.

Cada respuesta HTTP expone `Server-Timing` y `X-DB-Queries` para separar tiempo
total, PostgreSQL y llamadas a Meta, n8n o ElevenLabs desde DevTools. La
ruta `/health` comprueba que el proceso vive y `/health/ready` verifica además
la conexión con la base; los healthchecks de Docker usan esta última.
