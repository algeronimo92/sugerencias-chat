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

### 2. Reverse proxy (Traefik)

Se levanta una sola vez por servidor; es compartido entre proyectos que enruten por dominio.

```bash
docker compose -f traefik/reverse-proxy.docker-compose.yml --env-file traefik/.env up -d
```

### 3. Aplicación

`docker-compose.prod.yml` no se modifica: las labels de Traefik y la eliminación del bind directo al puerto 80 se aplican como override desde `traefik/docker-compose.yml`.

```bash
docker compose -f docker-compose.prod.yml -f traefik/docker-compose.yml up -d --build
```

La app queda expuesta en `https://chat.dermicapro.app` (ajustar el `Host` en `traefik/docker-compose.yml` si el dominio cambia).

### Desarrollo local

```bash
docker compose up -d --build
```

Usa `docker-compose.yml` (no el `.prod.yml`), con hot-reload y puertos locales (frontend `5174`, backend `8000`).

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

### Etiquetas, filtros e historial de cambios

La lista de leads permite combinar búsqueda, no leídos, etapas, etiquetas
(`cualquiera` o `todas`), servicio, vendedor, origen, último emisor e inactividad.
Las consultas mantienen la paginación por cursor y aplican los filtros en PostgreSQL.

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

### Biblioteca central de archivos

La vista administrativa `Archivos` centraliza imágenes, videos, audios y
documentos reutilizables. Admite búsqueda, filtros, vista previa y carga
múltiple mediante selector o drag-and-drop. Al cargar un adjunto desde una
plantilla también se incorpora automáticamente a la biblioteca. Desde el
editor puede elegirse un archivo existente sin crear otra copia física.

Los archivos vinculados a plantillas no pueden eliminarse hasta retirar esas
referencias. Los adjuntos históricos se registran automáticamente al iniciar;
la migración equivalente está en `backend/migrations/007_media_library.sql`.
