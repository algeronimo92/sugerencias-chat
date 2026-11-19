# 17 · Plan: contactos e importación (Meta y CSV)

Fecha: 2026-11-19. Estado: **implementado** en la rama `feature/contactos` (un solo PR, commits separados).

## 1. Qué se quiere

Una agenda de contactos como la de cualquier CRM: ver, buscar, editar y
etiquetar personas aunque todavía no hayan escrito, e importarlas desde:

1. **La app WhatsApp Business del celular** (coexistencia), vía la API de Meta.
2. **Un archivo CSV/Excel** (bases antiguas, otra herramienta, clínicas sin
   coexistencia o que ya pasaron la ventana de Meta).

Un contacto se vuelve lead cuando conversa o cuando alguien lo pasa al embudo
a mano. Importar no da permiso de escribirle: fuera de la ventana de 24 h solo
se pueden enviar plantillas aprobadas, y para marketing Meta exige
consentimiento previo (opt-in).

## 2. Lo que dice Meta (verificado en la documentación el 2026-11-19)

Fuente: *Onboarding WhatsApp Business app users* (Embedded Signup, custom flows).

- Endpoint: `POST /{phone_number_id}/smb_app_data` con
  `{"messaging_product": "whatsapp", "sync_type": "smb_app_state_sync"}`
  (contactos) o `"history"` (mensajes). Primero contactos, después historial.
  La respuesta solo acepta el pedido y devuelve un `request_id`.
- **Ventana de 24 h después del onboarding, y una sola vez por tipo.** Si se
  pierde, el negocio tiene que desvincularse y repetir el Embedded Signup.
- Los contactos llegan por el webhook `smb_app_state_sync`:
  `value.state_sync[]` con `type: "contact"`,
  `contact: {full_name, first_name, phone_number, user_id, parent_user_id?, username?}`,
  `action: "add" | "remove"` y `metadata.timestamp`. En `remove` no vienen los
  nombres. `phone_number` puede faltar: **la identidad es `user_id` (BSUID)**.
- Después de la carga inicial, cada alta, edición o baja hecha en la app del
  celular manda otro `smb_app_state_sync` (`add` sirve para alta y edición).
- Solo entran los contactos que tienen WhatsApp. No se sincronizan grupos.
- Historial (`history`): hasta 180 días, en fases (0-1, 1-90, 90-180 días),
  fragmentos desordenados (`chunk_order`, `progress = 100` al terminar). El
  error `2593109` en el webhook significa que el negocio no aceptó compartirlo.
  Los adjuntos solo traen id si tienen menos de 14 días.

## 3. Lo que hay hoy en el código

- En Meta ya están suscritos `smb_app_state_sync`, `history` y
  `smb_message_echoes` (ver memoria de coexistencia).
- `FIELD_HANDLERS` (`backend/app/integrations/meta_webhook/processor.py`) solo
  atiende `messages`, `smb_message_echoes` y plantillas. **`smb_app_state_sync` y
  `history` caen en "Field de Meta sin handler"** y se descartan. Como
  `webhook_inbox` borra los payloads procesados tras una retención corta, lo
  que haya llegado de DermicaPro ya no se puede recuperar.
- Nadie llama a `smb_app_data`. `complete_embedded_signup`
  (`backend/app/integrations/meta/client.py`) intercambia el `code`, suscribe la
  app a la WABA y guarda la conexión; ahí termina.
- `leads` ya tiene lo necesario para enlazar: `telefono`, `nombre`,
  `custom_fields` y `whatsapp_identities` (`kind IN ('wa_id','user_id')`), que
  ya acepta BSUID.
- No hay importación CSV ni pantalla de contactos.

**Consecuencia para DermicaPro:** se conectó el 2026-09-17 y la ventana de
24 h ya pasó. Hay dos caminos: (a) volver a hacer el signup de coexistencia
cuando el handler esté desplegado y llamar a la sincronización en el momento,
o (b) no tocar la conexión, recibir solo los cambios futuros y cargar la base
actual por CSV. Recomendación: **(b) primero**, y (a) solo si la dueña quiere
la agenda completa del celular; desvincular un número en producción tiene
riesgo propio.

## 4. Decisión de modelo: tabla `contacts` aparte de `leads`

Opciones:

| | `leads` con un flag | Tabla `contacts` (recomendada) |
|---|---|---|
| Embudo, Kanban, contadores | Se llenan de familia y proveedores del celular; hay que filtrar en cada consulta | Intactos |
| Automatizaciones (`lead_created`) | Se dispararían por cada contacto importado | No se disparan hasta que exista el lead |
| `leads` es tabla externa (n8n, sin autogenerate) | Migración manual y riesgo con n8n | Tabla nueva normal, autogenerate sirve |
| Costo | Menor al principio | Una tabla y un enlace más |

Se elige `contacts` con `lead_id` opcional. Un lead nuevo se enlaza a su
contacto por identidad (BSUID o teléfono). Promover un contacto crea el lead
y deja el enlace.

### Esquema (schema del tenant, revisión Alembic nueva)

```text
contacts
  id                uuid pk
  nombre, telefono (E.164, null si solo hay BSUID), wa_user_id (BSUID), username, email, notas
  etiquetas         text[]  default '{}'
  origen            'manual' | 'csv' | 'whatsapp_app' | 'lead'
  consentimiento_marketing boolean, consentimiento_at
  lead_id           uuid null fk leads(id) on delete set null
  editado_en_crm_at   -- desde ahí, el nombre del celular no pisa el del CRM
  eliminado_en_app_at -- 'remove' de Meta: no se borra, se marca
  meta_changed_at     -- metadata.timestamp del último evento aplicado
  ultima_interaccion_at -- último mensaje conocido (historial)
  check (telefono is not null or wa_user_id is not null)
  unique parcial (telefono), unique parcial (wa_user_id), index (lead_id), gin (etiquetas)

contact_import_batches   -- una importación por revisar (CSV o celular)
  id, source ('csv'|'whatsapp_app'), status ('open'|'closed'), file_name,
  created_by_user_id, closed_at; una sola abierta del celular a la vez

contact_import_rows      -- las filas que esperan; outcome null = pendiente
  batch_id, row_number, dedupe_key (BSUID o teléfono, única por importación),
  datos del contacto, ultima_interaccion_at, error, outcome
  ('created'|'updated'|'skipped'|'discarded'), contact_id

whatsapp_app_syncs       -- el pedido único a Meta, por número y tipo
  phone_number_id, sync_type, status ('requested'|'failed'|'receiving'|'done'|'declined'),
  request_id, error, progress, window_started_at (desde ahí corren las 24 h)

whatsapp_history_chunks  -- el historial tal como llegó
contact_settings         -- una fila: auto_import_whatsapp
```

Reglas:

- `remove` de Meta **no borra**: marca `eliminado_en_app_at`. El contacto puede
  tener notas o un lead enlazado en el CRM.
- `add` de Meta actualiza nombre y teléfono, pero **no pisa** lo que se editó a
  mano en el CRM (`editado_en_crm_at`).
- Se descartan eventos más viejos que `meta_changed_at` (los webhooks llegan
  desordenados).

## 5. Backend

### 5.1 Módulo `backend/app/modules/contacts/`

Módulo con dominio propio (como `leads`), no plano:

- `domain/`: normalización de teléfono (E.164 con el país del negocio por
  defecto), regla de fusión (qué gana entre Meta, CSV y edición manual) y
  validación de una fila de CSV. Sin SQLAlchemy.
- `application/`: casos de uso `upsert_from_whatsapp_app`,
  `import_csv`, `create`, `update`, `promote_to_lead`, `link_lead`. Levantan
  `DomainError`.
- `ports/`: repositorio de contactos y, hacia `leads`, una operación
  `ports/create_lead.py` que usa `leads/public.py`.
- `infrastructure/`: repositorio SQL.
- `api.py` + `schemas.py`: `GET /api/contacts` (búsqueda, etiquetas, origen,
  con o sin lead, paginado), `GET/PATCH/DELETE /api/contacts/{id}`,
  `POST /api/contacts`, `POST /api/contacts/{id}/lead`,
  `POST /api/contacts/imports` (subida), `GET /api/contacts/imports/{id}`.
  Todas con guard de usuario. Importar y borrar solo admin.
- `subscribers.py`: al crearse un lead (evento que ya exista en `leads`),
  enlazar o crear su contacto (`origen = 'lead'`). Así la agenda incluye
  también a quien escribió primero.
- Registrar el router en `app/bootstrap.py` y el modelo en
  `app/db/models/contacts.py` + `__init__.py`.
- Tests de capas (`test_layering.py`) y de rutas (`test_route_security.py`)
  sin agrandar allowlists.

### 5.2 Sincronización con la app de WhatsApp Business

1. **Pedido:** `meta_service.request_app_data_sync(phone_number_id, sync_type)`
   en `integrations/meta/client.py` (`POST .../smb_app_data`). Se llama al final
   de `complete_embedded_signup` **solo en coexistencia** (cuando el evento
   fue `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`), primero `smb_app_state_sync`.
   Se guarda `requested_at`, `request_id` y el estado. Si falla, el panel
   muestra un botón "Reintentar sincronización" mientras queden horas de la
   ventana de 24 h (calculada desde la conexión).
2. **Recepción:** handler `smb_app_state_sync` en `FIELD_HANDLERS`. Resuelve el
   tenant por `phone_number_id` (ya funciona igual que `messages`) y llama a
   `contacts.public.upsert_from_whatsapp_app(items)`. Debe ser idempotente: el
   inbox reintenta.
3. **Volumen:** una agenda puede traer miles de contactos en ráfaga. Upsert por
   lotes (`INSERT ... ON CONFLICT`) dentro de una sola transacción por evento, y
   una sola notificación de tiempo real por evento ("contactos actualizados"),
   no una por contacto.
4. **Enlace con leads:** al hacer upsert, buscar en `whatsapp_identities` por
   `user_id` y luego por `wa_id`/teléfono. Si hay lead, llenar `lead_id`.
5. **Métricas:** contador por acción (`add`/`remove`) y por resultado, para ver
   en Grafana que la sincronización llegó.

### 5.3 Historial (`history`): fuera de este plan

Requiere crear mensajes en `wsp_messages` (tabla externa), deduplicar con lo
que ya entró por `smb_message_echoes`, manejar fases y adjuntos que vencen. Es
su propio proyecto. Por ahora: **no pedirlo**, y loguear el webhook `history`
con una métrica para saber si llega.

### 5.4 Importación CSV

- Subida con límite de tamaño (p. ej. 5 MB / 20 000 filas). CSV con detección
  de separador (`,` o `;`, Excel en español usa `;`) y codificación (UTF-8 con
  o sin BOM, Latin-1). Un XLSX se rechaza pidiendo "Guardar como CSV UTF-8".
- Dos pasos: **previsualizar** (encabezados, 20 filas, mapeo sugerido por nombre
  de columna, conteo de inválidos y duplicados) y **confirmar** con el mapeo
  elegido. Columnas: nombre, teléfono, email, etiquetas, notas y una de
  consentimiento opcional.
- Modo de duplicados: "omitir" (por defecto) o "actualizar vacíos". Nunca
  pisar datos editados.
- Pasar a lead es una acción aparte (de a uno o en lote desde la agenda), con
  las automatizaciones de lead nuevo: importar nunca crea leads.
- Se procesa en la misma petición (inserción por lotes de 1000): 20 000 filas
  entran en segundos. El archivo viaja en base64 como el resto de las subidas
  del CRM (el backend no tiene `python-multipart`).

## 6. Frontend

- Feature nueva `frontend/src/features/contacts/` en la capa 4 de
  `FEATURE_LAYERS` (después de `leads`, que necesita para promover; antes de
  `chats`, que la usará para "abrir chat con contacto").
- Ruta `contacts` en `app/routes.tsx` y entrada en la navegación (también en la
  barra inferior móvil si cabe; si no, en "Más").
- Pantalla: tabla con búsqueda, filtros (origen, etiqueta, con/sin lead,
  eliminado en el celular), selección múltiple para etiquetar o pasar a lead.
  En móvil, lista de tarjetas.
- Detalle en panel lateral: datos, notas, etiquetas, consentimiento, lead
  enlazado (link al chat) y origen.
- Asistente de importación: subir, mapear, revisar, confirmar, informe.
- Tarjeta en Integraciones o en el panel de WhatsApp: estado de la
  sincronización con el celular (pedida, recibiendo, última novedad, error) y
  el botón de reintento dentro de la ventana.
- Estados vacío, carga y error; tokens de `index.css`; componentes de menos de
  400 líneas.
- `api.ts` con `ApiResponse<...>`, claves en `keys.ts`, `schema.d.ts`
  regenerado en el mismo PR que la API.

## 7. Elegir cuántos contactos importar (como ManyChat)

Ninguna importación entra directo a la agenda: sus filas esperan en
`contact_import_rows` y alguien elige qué parte pasa. ManyChat, al conectar
la app del celular, deja importar los contactos de los últimos 1, 90 o 180
días; acá se ofrece lo mismo y algo más:

- **Todos** los pendientes válidos.
- **Solo los que conversaron en los últimos N días** (1, 7, 30, 90, 180),
  con el conteo de cada periodo a la vista. La fecha sale del historial
  (`history`); un CSV no la tiene.
- **Uno por uno**, marcando filas en una lista paginada con buscador.
- En cualquier caso, **un tope opcional** ("como máximo 500"), que se llena
  empezando por la conversación más reciente.
- Duplicados: "dejar igual" (por defecto) o "completar lo vacío", que nunca
  pisa un dato ni el nombre editado en el CRM.
- Etiquetas para todos los importados y la opción de descartar el resto al
  terminar. Si no se descarta, lo no elegido sigue esperando y se puede
  volver por otra tanda.

Las conversaciones del historial con gente que **no está guardada** en la
agenda del celular también se ofrecen: suelen ser justo los interesados.

Lo nuevo que se guarde en el celular después de la carga inicial espera en
la misma importación abierta, salvo que se active "Agregar solos los
contactos nuevos".

## 8. Entrega

Un solo PR con commits separados: tablas, agenda e importación por CSV,
sincronización con la app del celular, pantalla y este documento. El
historial de mensajes se guarda tal como llega (`whatsapp_history_chunks`)
pero no se vuelca al chat: importarlo sigue siendo un proyecto aparte
(sección 5.3).

## 9. Pruebas

- Dominio: normalización de teléfonos (con y sin `+`, con 0 inicial, país por
  defecto), reglas de fusión, orden de eventos.
- Webhook: `add` nuevo, `add` que edita, `remove`, evento viejo ignorado,
  contacto sin `phone_number`, mismo evento dos veces (idempotencia), tenant
  correcto con dos negocios (test de Postgres en
  `test_meta_webhook_postgres.py`).
- CSV: separadores, BOM, Latin-1, filas inválidas, duplicados dentro del
  archivo y contra la base.
- Arquitectura: `test_layering.py`, `test_route_security.py`,
  `architecture.test.ts`, `alembic check`.
- E2E: lista de contactos e importación en escritorio y celular.

## 10. Preguntas abiertas para el negocio

1. ¿DermicaPro necesita la agenda completa del celular (implica repetir el
   signup de coexistencia) o basta con CSV y los cambios desde ahora?
2. ¿Quién puede importar y borrar contactos: solo admin, o también vendedoras?
3. ¿Los contactos se ven todos para todos, o cada vendedora solo los de sus
   leads (como hoy con la asignación)?
4. ¿Se quiere el historial de chats de 180 días (proyecto aparte, sección 5.3)?
