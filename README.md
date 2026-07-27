# sugerencias-chat

## Despliegue en producción (con Traefik)

Requiere Docker y el plugin Docker Compose. El dominio debe apuntar (registro A) a la IP del servidor antes de levantar el proxy, para que el challenge HTTP-01 de Let's Encrypt funcione.

### 1. Variables de entorno

```bash
cp backend/.env.example backend/.env      # completar DATABASE_URL, N8N_WEBHOOK_URL, etc.
cp traefik/.env.example traefik/.env      # completar ACME_EMAIL
```

`DATABASE_URL` y `CORS_ORIGINS` solo se configuran acá (son necesarios para que la app arranque). El resto de las claves de servicios externos (n8n, Evolution API, ElevenLabs) se pueden completar en este archivo como semilla inicial, pero también se pueden cargar y editar después desde la propia app: ícono de engranaje ⚙️ en la barra superior → "Configuración" (solo visible para usuarios admin). Lo que se guarde ahí desde la UI tiene prioridad sobre el `.env`.

**Primer login:** la app requiere iniciar sesión. Para crear la primera cuenta (admin), completá `SECRET_KEY` (generarla con `openssl rand -hex 32`), `ADMIN_EMAIL` y `ADMIN_PASSWORD` en `backend/.env` antes de levantar el backend por primera vez — se crea automáticamente al arrancar si la tabla `users` está vacía. Después de loguearte podés borrar `ADMIN_PASSWORD` del archivo (no se vuelve a leer una vez que existe algún usuario). Desde "Configuración → Usuarios" el admin da de alta al resto del equipo (vendedores).

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

**No publica ningún puerto.** Se llega por la red `dermicapro-data`, a la que se suman la aplicación y n8n:

```bash
docker network connect dermicapro-data <contenedor-de-n8n>
```

En `backend/.env`, la conexión pasa a ser interna:

```
DATABASE_URL=postgresql+asyncpg://dermicapro:<password>@postgres:5432/dermicapro
DATABASE_SSL=disable
```

`disable` es correcto aquí: el tráfico no sale de la red de Docker.

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

### 5. Despliegue blue-green (opcional)

Alternativa a los pasos anteriores para desplegar **sin corte**. La versión nueva se levanta al lado de la que sirve, se migra y se comprueba mientras nadie la usa; sólo entonces se conmuta el tráfico reescribiendo `traefik/dynamic/active.yml`, que Traefik relee en caliente.

No se combina con `traefik/docker-compose.yml`: aquel enruta por etiquetas de Docker y este por el archivo dinámico, y ambos reclamarían el mismo `Host`.

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

Usa `compose.yml` (no el `.prod.yml`), con hot-reload y puertos locales (frontend `5174`, backend `8000`).

### Mensajes leídos de WhatsApp (n8n + Evolution API)

Cuando n8n inserta un mensaje entrante en `wsp_messages`, también debe guardar
el ID de WhatsApp en `wa_message_id`. Para el payload actual de n8n, el mapeo es:

```text
wa_message_id = {{ $json.instance.message_id }}
```

Si el nodo todavía conserva el payload original de Evolution API, el mismo dato
suele estar en `key.id`; se debe usar el campo que contenga ese ID en el punto
exacto donde se ejecuta el `INSERT`. No se debe usar el ID interno/autonumérico
de `wsp_messages`.

Al abrir un chat, el frontend llama `POST /api/chats/{remoteJid}/read`. El backend
busca los `wa_message_id` pendientes del cliente y envía a Evolution API:

```text
POST {EVOLUTION_API_URL}/chat/markMessageAsRead/{EVOLUTION_INSTANCE}
```

Los mensajes históricos que tengan `wa_message_id` en `NULL` no pueden marcarse
como leídos en WhatsApp; el flujo comenzará a funcionar para los mensajes nuevos
después de agregar el mapeo al nodo de inserción de n8n.

Si una integración guardó mensajes con `sender` en `NULL` pero conservó su
`wa_message_id`, se puede recuperar `key.fromMe` directamente desde Evolution.
Primero ejecutar la simulación, que no escribe en PostgreSQL:

```bash
docker compose exec -T backend python -m scripts.backfill_message_senders
```

El reporte solo muestra conteos y nunca imprime contenido, credenciales ni IDs
de WhatsApp. Después de revisar cuántos registros se resolvieron, aplicar el
resultado explícitamente:

```bash
docker compose exec -T backend python -m scripts.backfill_message_senders --apply
```

Se pueden usar `--limit 5`, `--chat-id <remoteJid>` y `--concurrency 5` para
hacer una prueba acotada. Solo se actualizan filas que todavía tengan
`sender IS NULL` y cuya respuesta contenga un `fromMe` booleano inequívoco.
Después del backfill, aplicar
`backend/migrations/019_wsp_message_sender_not_null.sql` para que PostgreSQL
rechace cualquier nuevo mensaje que no indique `cliente` o `vendedor`.

### Doble check de mensajes enviados

La instancia de Evolution debe tener habilitado el evento `MESSAGES_UPDATE`.
n8n puede reenviar el JSON original, sin transformarlo, a:

```text
POST https://chat.dermicapro.app/api/webhooks/message-status
X-Webhook-Token: <mismo valor de INBOUND_WEBHOOK_TOKEN>
Content-Type: application/json
```

El endpoint también acepta el contrato plano
`{"wa_message_id": "...", "status": "READ", "from_me": false}`. Los cambios
se publican por WebSocket y el chat muestra un check gris al enviar, dos grises
al entregar y dos azules al leer. Si `READ`/`PLAYED` llega con `from_me=false`,
el backend interpreta que un dispositivo vinculado (por ejemplo WhatsApp Web)
leyó un mensaje del cliente y avanza `last_read_at` hasta la fecha exacta de ese
mensaje; no marca como vistos mensajes posteriores. La migración manual para instalaciones existentes es
`backend/migrations/016_message_delivery_status.sql`; el backend también la
aplica de forma idempotente al arrancar.

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

El backend crea las tablas nuevas mediante `Base.metadata.create_all()` al arrancar.
Para aplicarlas explícitamente en otro entorno también está disponible:

```text
backend/migrations/001_lead_tags_activity.sql
```

Las tablas `lead_tags`, `lead_tag_assignments` y `lead_activity` tienen RLS
habilitado y se consumen exclusivamente a través del backend autenticado.

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
Evolution API. La migración explícita está en
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
estilo diferenciado y nunca se envían por Evolution API. Al escribir `@` se
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
El backend las envía mediante `message/sendTemplate` y vuelve a comprobar tipo,
estado y cantidad de parámetros.

Evolution API solo implementa ese envío para instancias con integración
`WHATSAPP-BUSINESS` (Meta Cloud API). Si la instancia usa
`WHATSAPP-BAILEYS`, el CRM conserva y administra las plantillas, pero muestra
el motivo y bloquea el envío oficial. La migración correspondiente está en
`backend/migrations/010_official_templates.sql`.

### Botones y listas interactivas

Las plantillas internas pueden enviarse como texto normal, mensaje con botones
o mensaje de lista. Los botones admiten respuesta, URL, llamada o copia de
código; los de respuesta se limitan a tres y no se mezclan con otros tipos.
Las listas permiten varias secciones y hasta diez opciones con IDs únicos.

El editor configura la estructura, la vista previa simula la tarjeta y el
desplegable de WhatsApp, y el backend vuelve a validar los límites antes de
usar `message/sendButtons` o `message/sendList` en Evolution API. Las variables
del CRM también se resuelven en títulos, pies, botones, secciones y opciones.
Estos mensajes requieren que la ventana de atención esté abierta. La migración
correspondiente está en `backend/migrations/011_interactive_templates.sql`.

### Envío asíncrono y diagnóstico de latencia

Los mensajes de texto se registran primero como `PENDING` junto con una fila
durable en `message_outbox`. El request HTTP responde sin esperar a Evolution
API; un worker integrado los envía en segundo plano, conserva el orden por chat
y hace hasta tres intentos antes de marcar el mensaje como `FAILED`. Esto no
requiere RabbitMQ para el volumen actual y evita perder trabajos si el backend
se reinicia. La migración manual equivalente está en
`backend/migrations/017_message_outbox.sql`.

Desde el panel de un lead también puede programarse un texto para una fecha y
hora futuras. El registro permanece en `scheduled_messages` y puede cancelarse
mientras siga programado. Al vencer, el worker comprueba la ventana de atención
de 24 horas y recién entonces crea el mensaje `PENDING` y su trabajo de outbox.
La vista muestra si quedó programado, está enviándose, fue enviado o falló. La
migración manual está en `backend/migrations/018_scheduled_messages.sql`.

Cada respuesta HTTP expone `Server-Timing` y `X-DB-Queries` para separar tiempo
total, PostgreSQL y llamadas a Evolution, n8n o ElevenLabs desde DevTools. La
ruta `/health` comprueba que el proceso vive y `/health/ready` verifica además
la conexión con la base; los healthchecks de Docker usan esta última.
