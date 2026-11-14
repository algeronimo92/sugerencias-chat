# 14 · Diseño: eventos de conversión a Meta (API de Conversiones para WhatsApp)

Fecha: 2026-11-09 · Estado: **implementado (2026-11-14), apagado por defecto** · Origen: la auditoría 11 (hallazgo N5, "métricas de operación, no de ROI") y la revisión del panel de Meta de la app CliniVentas.

## 1. Qué se quiere y por qué

Hoy Meta solo sabe que un anuncio de clic a WhatsApp (CTWA) generó una conversación. No sabe si esa persona agendó ni si compró, así que optimiza las campañas por "gente que escribe" y no por "gente que paga". La API de Conversiones para mensajería de negocios cierra ese ciclo: el CRM le avisa a Meta, con el identificador del clic (`ctwa_clid`), cuando el lead entra, cuando califica y cuando compra, con el monto.

Lo que se gana, en orden de valor:

1. Ads Manager muestra compras e ingreso por anuncio, no solo conversaciones.
2. El negocio puede cambiar la optimización de la campaña a "conversiones" cuando tenga volumen.
3. El CRM deja de depender de los subworkflows de n8n `SUB - save CTWA` y `pixel lead` que la auditoría 10 pidió inventariar: la atribución pasa a ser nativa.

Lo que **no** cubre este diseño: conversiones de la web (eso es la API de Conversiones web, otro dataset), leads que no llegaron por anuncio (no hay `ctwa_clid`; la vía alternativa con teléfono hasheado exige `page_id`, atribuye solo 7 días y está limitada por país) y revertir una compra ya informada (Meta no tiene "devolución" para mensajería; ver §7).

## 2. Lo que exige Meta (verificado en la doc oficial y en foros)

| Requisito | Detalle | Estado en CliniVentas |
|---|---|---|
| Permiso `whatsapp_business_manage_events` con acceso avanzado | Se pide en "Permisos y funciones"; Meta lo aprueba automático si ya hay acceso avanzado a `whatsapp_business_messaging` | **Falta**. El panel solo lista `whatsapp_business_messaging`, `whatsapp_business_management` y `public_profile` |
| Función "Marketing API Access Tier" | La doc se contradice: 500 o 1500 llamadas en 15 días con <10 % de error | Confirmar en el panel |
| Token con el permiso nuevo | El System User token actual no lo trae: hay que regenerarlo | `meta_access_token` por negocio |
| Dataset ligado a la WABA | `POST /{WABA_ID}/dataset` lo crea o devuelve el existente; los eventos van a `POST /{DATASET_ID}/events` | No existe |
| `ctwa_clid` | Llega una sola vez, en `messages[].referral` del primer mensaje del cliente; nunca en anuncios de Estados; sin hashear | Ya se guarda en `wsp_messages.provider_payload.referral` |
| Nombres de evento | Lista cerrada: `Purchase`, `LeadSubmitted`, `QualifiedLead`, `InitiateCheckout`, `AddToCart`, `ViewContent`, `OrderCreated`, `OrderShipped`, `OrderDelivered`, `OrderCanceled`, `OrderReturned`, `CartAbandoned`, `RatingProvided`, `ReviewProvided`. `Lead`, `Contact`, `Schedule`, `LeadQualified` se rechazan (código 100, subcódigo 2804066) | — |
| Deduplicación | Meta **no** deduplica estos eventos; hay que hacerlo antes de enviar | — |
| `event_time` | Más de 7 días atrás se rechaza; en milisegundos o futuro también | — |
| `currency` en `Purchase` | Obligatoria (subcódigo 2804081 si falta) | La moneda del negocio está en `AIProfile.currency` |

Errores que la comunidad ya documentó y cómo se traducen aquí: 2804066 (nombre inválido) y 2804081 (sin moneda) son definitivos y señalan un bug nuestro; 2804131 ("No Page associated to dataset") es enviar al píxel o usar `page_id` en vez de `whatsapp_business_account_id`; 190 es token vencido o sin permiso (alerta operativa, como ya hace el canal); 429 y 5xx se reintentan; un 200 con `events_received: 0` se trata como fallo.

Payload de referencia:

```json
{
  "data": [{
    "event_name": "Purchase",
    "event_time": 1794261867,
    "action_source": "business_messaging",
    "messaging_channel": "whatsapp",
    "user_data": {
      "whatsapp_business_account_id": "<WABA_ID>",
      "ctwa_clid": "<CTWA_CLID>"
    },
    "custom_data": { "currency": "PEN", "value": 450.00 }
  }],
  "test_event_code": "<solo durante la prueba>"
}
```

## 3. Los tres eventos y cuándo se disparan

| Evento | Momento en CliniVentas | Gancho de dominio | Clave de deduplicación |
|---|---|---|---|
| `LeadSubmitted` | Primer mensaje de un cliente que llega con `referral.ctwa_clid` | Captura del clic en el webhook (§4.1) | `<lead_id>:LeadSubmitted` (una vez por lead, aunque vuelva a tocar anuncios) |
| `QualifiedLead` | Se registra la primera cita real del lead | Nuevo evento `LeadAppointmentScheduled` emitido por `register_appointment` | `<lead_id>:QualifiedLead` |
| `Purchase` | Se registra una venta (`record_sale`), con `amount` y la moneda del negocio | `LeadSaleChanged` con `deleted=False` | `<lead_id>:Purchase:<sale_id>` (una por venta, un lead puede comprar varias veces) |

Decisiones que la doc de Meta deja abiertas y que acá se fijan:

- **Qué clic se atribuye.** Un mismo cliente puede tocar varios anuncios y cada toque trae un `ctwa_clid` distinto. `LeadSubmitted` lleva el clic que lo originó. `QualifiedLead` y `Purchase` llevan **el último clic anterior al evento**: es el modelo de último toque que Meta usa en el resto de sus informes, y es el anuncio que efectivamente trajo de vuelta al cliente. Queda registrado en la fila del evento (§4.2) para poder discutirlo con datos.
- **Qué es "calificado".** En una clínica el salto de valor es agendar. Una etapa configurable ("esta etapa cuenta como calificado") es la extensión natural, pero exige DDL en `lead_stages` y UI; va en una segunda entrega si el negocio lo pide.
- **Compras tardías.** Una venta cargada con `sold_at` más de 7 días atrás no se envía (Meta la rechaza) y queda como `omitida` con motivo, visible para el admin.
- **Sin clic, sin evento.** Un lead que escribió desde el enlace de la bio o un QR no genera nada. No es un error y no se registra como fallo.

## 4. Arquitectura

Todo vive en el módulo `leads`, que ya es dueño de `leads`, `lead_sales`, `lead_stages` y `wsp_ad`. Así no se agrega ninguna entrada a `FOREIGN_TABLES` ni a `META_ALLOWED`, que solo pueden achicarse.

```text
leads/
├── domain/events.py            + LeadAppointmentScheduled
├── attribution/                 subpaquete, como leads/dashboard/
│   ├── events.py                arma el evento Meta a partir del hecho (función pura, sin SQL)
│   ├── commands.py              record_ad_click, queue_conversion, mark_sent/failed/skipped
│   ├── repository.py            SQL de wsp_ad y meta_conversion_events (único que las escribe)
│   ├── worker.py                pasada por negocio: reclama pendientes y las manda por el puerto
│   ├── queries.py               estado para el panel y para la ficha del lead
│   └── ports.py                 ConversionSender (Protocol) + provide_conversion_sender
├── ports/ad_referral_service.py + record_ad_click (lo llama el webhook, como hoy rehost_referral_image)
└── subscribers.py               + 3 suscriptores en fase TRANSACTION
```

### 4.1 Captura del clic (entrada)

`meta_webhook/processor.py` ya detecta `message.get("referral")` y llama a un puerto de `leads`. Se agrega una segunda llamada al mismo puerto: `record_ad_click(chat_id, referral, occurred_at, wa_message_id)`. El comando inserta en `wsp_ad` una fila por `ctwaclid` (`ON CONFLICT DO NOTHING` sobre un índice único parcial nuevo), con `source_id`, `source_url`, `cta`, `thumbnail_url`, `fecha_interaccion`, `plataforma = "meta"` y `lead_id = chat_id`. Si la fila es nueva y el lead no tiene todavía un `LeadSubmitted`, encola ese evento en la misma transacción.

Esto convierte a `wsp_ad` en el registro nativo de clics. Hoy la llena n8n (`SUB - save CTWA`): mientras convivan, el índice único evita duplicados; después se apaga el subworkflow (§8).

### 4.2 Libro mayor: `meta_conversion_events`

Tabla nueva, propiedad de `leads`. Es a la vez la cola y la deduplicación, igual que `message_outbox` lo es para los envíos.

| Columna | Para qué |
|---|---|
| `id`, `lead_id` FK, `wsp_ad_id` FK | Qué lead y qué clic se atribuyó |
| `event_key` **único** | `<lead_id>:LeadSubmitted`, `<lead_id>:QualifiedLead`, `<lead_id>:Purchase:<sale_id>`. La unicidad es la deduplicación que Meta no hace |
| `event_name`, `event_time`, `custom_data` JSONB | Lo que se manda; `custom_data` guarda `value` y `currency` tal como salieron |
| `status` | `pending` → `sent` / `failed` / `skipped`. `skipped` lleva motivo (sin moneda, más de 7 días, sin clic) |
| `attempts`, `next_attempt_at`, `last_error` | Reintentos con la misma política de `message_outbox` |
| `meta_trace_id`, `sent_at` | `fbtrace_id` de la respuesta, para reclamar en el soporte de Meta |

La fila se escribe en un suscriptor de fase **TRANSACTION**: si la venta se revierte, el evento no existe. El envío HTTP nunca ocurre dentro de la transacción. Es exactamente la regla de `core/events.py`: "transaction: auditoría, agendado, el outbox".

### 4.3 Suscriptores (en `leads/subscribers.py`)

```python
@subscribe(LeadAppointmentScheduled, phase=Phase.TRANSACTION)   # → QualifiedLead
@subscribe(LeadSaleChanged, phase=Phase.TRANSACTION)             # → Purchase si not deleted
```

Cada uno llama a `queue_conversion(lead_id, event)`: busca el último clic del lead, decide si corresponde (`skipped` con motivo si no), arma `event_key` y hace `INSERT … ON CONFLICT DO NOTHING`. Si el negocio tiene la función apagada (`meta_capi_enabled` = false) no se escribe nada: no se acumula deuda para enviar después, porque a los 7 días Meta la rechazaría igual.

`LeadSubmitted` no necesita suscriptor: lo encola `record_ad_click` (§4.1), que corre en la misma unidad de trabajo del webhook.

### 4.4 Worker de envío

`TenantLoop("meta-conversions", conversions_tick, wait_for_conversions_work)` en `runtime.BACKGROUND_LOOPS`, con una señal `meta_conversions` que `queue_conversion` toca al encolar (`ring_soon`), como hace el outbox. La pasada:

1. Si `meta_capi_enabled` es falso, no hace nada.
2. Resuelve el dataset: lee `meta_capi_dataset_id`; si está vacío, pide `POST /{WABA_ID}/dataset` y lo guarda con `update_settings`. Una vez por negocio.
3. Reclama hasta 1000 filas `pending` vencidas (`FOR UPDATE SKIP LOCKED`, como `claim_batch`) y las manda en **una** llamada; Meta acepta hasta 1000 eventos por petición.
4. Respuesta 200 con `events_received == len(batch)`: todas a `sent`. Si `events_received` es menor, se parte el lote y se reintenta de a uno (Meta rechaza la petición entera cuando un evento es inválido, así que el lote es todo o nada; el camino de a uno aísla al culpable).
5. Errores: 429/5xx/red → `pending` con backoff (1 min, 5 min, 30 min, 2 h, 6 h) hasta que `event_time` cumpla 7 días, entonces `failed`. Código 100 con subcódigo 2804066/2804081/2804131 → `failed` definitivo y log de error (es un bug nuestro). Código 190 → `failed` definitivo y `try_send_operational_alert("meta-capi-token")`, igual que el canal con el token vencido.

El worker no importa `app.integrations.meta.client`: recibe un `ConversionSender` inyectado desde `composition.py`, igual que `meta_costs` recibe su `fetch`. Las dos operaciones nuevas (`ensure_dataset`, `send_conversion_events`) se agregan a `app/integrations/meta/client.py`, donde ya están `_config`, `_raise_meta_error` y las métricas. Resultado: `META_ALLOWED` no cambia.

### 4.5 Configuración por negocio (`SETTING_DEFS`)

| Clave | Visible | Uso |
|---|---|---|
| `meta_capi_enabled` | sí, booleana | Interruptor. Apagado por defecto |
| `meta_capi_test_event_code` | sí | Código de "Probar eventos" de Events Manager; mientras esté lleno se manda en cada petición y los eventos no cuentan en los informes |
| `meta_capi_dataset_id` | oculta | Cache del dataset de la WABA |

La moneda de `Purchase` sale de `AIProfile.currency` (perfil del negocio). Hoy `ai` no la publica: se agrega `ai/ports/profile.py` que reexporta `get_profile` con `__all__`, como piden `test_cross_domain_imports_use_explicit_contracts_without_exceptions` y `test_operation_ports_are_small_explicit_owner_contracts`. Si está vacía, el evento queda `skipped` con motivo "sin moneda configurada" y el panel lo muestra.

### 4.6 Panel y ficha

- Sección nueva en `WhatsappPanel` (feature `platform`): interruptor, estado del dataset, campo de prueba, y contadores de los últimos 30 días (enviados, omitidos, fallidos por tipo) con el último error. Endpoint `GET /api/platform/meta/conversions` con el guard de admin, más `PATCH` para los dos ajustes vía el endpoint genérico de settings que ya existe.
- En la ficha del lead, el historial ya muestra la venta; se agrega una actividad `meta_conversion_sent` cuando el worker confirma (`"Compra informada a Meta · S/ 450"`), escrita por un comando de `leads`. Es lo que le permite a la dueña ver que "sí llegó" sin entrar a Events Manager.
- Métricas Prometheus en `meta_webhook/metrics.py`: `meta_conversions_sent_total{event_name}`, `meta_conversions_failed_total{code}`, `meta_conversions_skipped_total{reason}`.
- `schema.d.ts` se regenera en el mismo PR del endpoint.

## 5. Esquema (una revisión Alembic)

1. `CREATE TABLE meta_conversion_events` (§4.2) con `UNIQUE (event_key)` e índice `(status, next_attempt_at)` para el reclamo.
2. Índice único parcial `uq_wsp_ad_ctwaclid ON wsp_ad (ctwaclid) WHERE ctwaclid IS NOT NULL`. Antes de crearlo, la migración borra duplicados exactos conservando la fila más antigua. Se valida primero en la base local con una copia; si producción tuviera duplicados con datos distintos (n8n pudo insertar dos veces), la migración falla en `alembic check` y se resuelve a mano antes de desplegar.
3. `wsp_ad.lead_id` pasa a rellenarse siempre en la captura nativa; la columna ya existe.

`leads` y `wsp_messages` están en `EXTERNAL_TABLES`: esta revisión no las toca.

## 6. Pruebas

- **Unitarias con dobles** (`backend/tests/`): `event_key` por tipo; selección del último clic; `skipped` por moneda, por 7 días y por falta de clic; traducción de cada código de Meta a `pending`/`failed`/alerta; partición del lote cuando `events_received` no coincide; el suscriptor no escribe con la función apagada.
- **Postgres real**: `ON CONFLICT` del clic repetido; `FOR UPDATE SKIP LOCKED` con dos pasadas concurrentes no mandan la misma fila; la migración de duplicados.
- **Arquitectura**: `test_layering` sigue verde sin tocar allowlists. Lo que se verificó contra las reglas actuales: el webhook entra a `leads` por `ports/` (regla de integraciones), `attribution/` no se llama `application/` así que puede usar SQLAlchemy y `app.db.models.leads`, `publish` no aparece (todo va por `collect` en la transacción), el worker no importa `app.integrations.meta.client` (recibe el puerto inyectado) y la moneda llega por un puerto de `ai`. Las rutas nuevas llevan guard y no entran en `PUBLIC_ROUTES`.
- **Contra Meta**: con `meta_capi_test_event_code` puesto, un lead de prueba que entra desde un anuncio real, agenda y compra; los tres eventos aparecen en "Probar eventos" con `ctwa_clid` y fuente `business_messaging`.

## 7. Límites conocidos

- **Venta borrada después de enviada.** Meta no ofrece reversión para mensajería (`OrderReturned` es de pedidos). La fila queda `sent` con marca `revoked_at` local para que el panel del CRM no la cuente; Ads Manager seguirá mostrando la compra. Se documenta en la UI de borrar venta.
- **Clic perdido entre sistemas.** Si un cliente escribe desde el anuncio a un número que no es el de la WABA conectada, o si Meta omite el `ctwa_clid` (anuncios en Estados), no hay nada que enviar. Un participante del foro de Meta reporta que solo una fracción pequeña de conversaciones trae el identificador; el panel mostrará "leads con clic / leads totales" para calibrar expectativas.
- **Sin histórico.** Nada anterior al despliegue se envía: `event_time` mayor a 7 días se rechaza.
- **Moneda.** Si el negocio cobra en otra moneda que la del perfil, el valor llega mal etiquetado. Es la misma fuente que ya usan los paquetes del catálogo, así que es consistente con lo que ve la vendedora.

## 8. Plan de entrega

| Paso | Qué | Quién |
|---|---|---|
| 0 | En el panel de Meta: pedir acceso avanzado a `whatsapp_business_manage_events`, confirmar el "Marketing API Access Tier", agregar el permiso a la configuración del Embedded Signup y regenerar el System User token de DermicaPro | Admin de la app (no es código) |
| 1 | **PR 1 (esquema y captura):** migración, modelos, `record_ad_click` desde el webhook, `LeadAppointmentScheduled`, suscriptores que escriben el libro mayor. Sin envío: la función nace apagada | Backend |
| 2 | **PR 2 (envío y panel):** `ensure_dataset` y `send_conversion_events` en el cliente de Meta, puerto y worker, ajustes, endpoint, sección en `WhatsappPanel`, `schema.d.ts`, métricas | Backend + frontend |
| 3 | Encender en DermicaPro con `meta_capi_test_event_code`; verificar los tres eventos en Events Manager; vaciar el código de prueba | Admin + dev |
| 4 | Inventariar `SUB - save CTWA` y `pixel lead` en n8n y apagarlos: el `pixel lead` manda un `Lead` al píxel web, que no se dedupe con esto y ensucia la atribución | Dev + dueño de n8n |
| 5 | Cuando haya ~50 compras por conjunto de anuncios por semana (cifra de integradores, no de Meta), cambiar la optimización de la campaña a conversiones. Hasta entonces, los eventos solo informan | Negocio |

Los pasos 1 y 2 respetan la regla de un PR para DDL y otro para comportamiento. Nada de esto toca el envío de mensajes ni el webhook más allá de una llamada adicional al puerto que ya existe.

## 9. Preguntas abiertas para el negocio

1. ¿"Calificado" es agendar cita, o prefieren marcar una etapa del embudo? (Afecta solo a `QualifiedLead`; se puede cambiar después sin reenviar nada.)
2. ¿La moneda del perfil (`AIProfile.currency`) es la que cobran en todas las ventas?
3. ¿Quién administra la app en el panel de Meta para el paso 0? Sin ese permiso nada de lo demás funciona, y conviene pedirlo ya porque la aprobación puede tardar.

## 10. Lo que la política pública ya promete (2026-11-13)

El apartado 8 de `cliniventas.com/tratamiento-de-datos` es lo que lee quien revisa el permiso, y las Condiciones de la plataforma de Meta (4.c) obligan a tratar los datos solo como la política describe. Estas frases ya están escritas ahí; el código tiene que cumplirlas o hay que cambiar el texto en el mismo PR:

| La política dice | Qué exige al código |
|---|---|
| "Está apagada por defecto. Se enciende solo cuando la clínica lo autoriza y acepta las Condiciones de las herramientas comerciales de Meta" | `meta_capi_enabled` nace en falso (§4.5) y el interruptor del panel muestra y registra esa aceptación (quién y cuándo) |
| Son tres eventos: `LeadSubmitted`, `QualifiedLead`, `Purchase` | Agregar un cuarto evento obliga a tocar la política antes |
| "De una venta viajan el importe total y la moneda, no qué se compró" | `custom_data` lleva solo `value` y `currency`: nunca `content_name`, `contents` ni el paquete |
| "El número de teléfono, el nombre ni el correo del paciente, tampoco cifrados" | La vía sin clic (`page_id` + teléfono con hash) queda fuera; usarla es cambiar la política y avisar a las clínicas |
| "No ofrecemos esta función a clínicas cuya especialidad, por sí sola, revele una condición de salud" | Decisión de alta por negocio, no de código: quien enciende el interruptor en plataforma responde de esto |
| "Ese registro se borra con el lead" y "eliminamos también el identificador del clic" | `meta_conversion_events.lead_id` con `ON DELETE CASCADE`. **Hoy no se cumple para `wsp_ad`**: su `lead_id` es `ON DELETE SET NULL`, así que al borrar un lead la fila queda con `telefono`, `nombre`, `email` y `ctwaclid`. Hay que corregirlo en la migración del PR 1 (cascada, o borrado explícito en `delete_lead` incluyendo las filas sin `lead_id` de ese teléfono) |
| "Si pide a la clínica que borre sus datos, no se envía ningún evento más" | Las filas `pending` del lead borrado desaparecen con la cascada antes de que el worker las reclame |

Pendiente de comprobar antes de pedir el permiso: qué manda hoy el subworkflow `pixel lead` de n8n. Si incluye el teléfono, aunque sea con hash, la tabla "no se envía nunca" es falsa hasta que se apague (paso 4 de §8).

## 11. Lo implementado y en qué se aparta (2026-11-14)

Código en `backend/app/modules/leads/attribution/`. Se siguió el diseño salvo en esto:

- **`Purchase` sale de la cita con adelanto**, no de `record_sale`: el registro de compras se quitó (`a8e469c2`) y la venta del negocio es la separación de la cita. Una por cita (`<lead>:Purchase:<cita>`), con el adelanto y la moneda del perfil. `QualifiedLead` y `Purchase` cuelgan del mismo evento, `LeadAppointmentScheduled`.
- **Sin `revoked_at`**: las citas no se borran, así que no hay nada que lo marque (§7).
- **Sin clic no se escribe nada**, ni como `skipped` (§3 "sin clic, sin evento"). La proporción de leads con clic la da el panel aparte.
- **Ruta `/api/whatsapp/conversions`** (GET y PUT, solo admin) en vez de `/api/platform/meta/conversions`: `/api/platform/*` solo responde en hosts de plataforma y el panel vive en el CRM del negocio.
- **`meta_capi_enabled` no aparece en la lista genérica de claves**: se enciende solo desde el panel, que exige aceptar las Condiciones y guarda quién y cuándo (`meta_capi_accepted_by`, `meta_capi_accepted_at`), como pide §10.
- **Moneda**: `leads/dashboard/currency.business_currency`, que ya lee `AIProfile.currency` por el contrato de `ai` y descarta lo que no es ISO 4217 (Meta lo exige). No hizo falta `ai/ports/profile.py`.
- **Sin índice único en `wsp_ad.ctwaclid`** (§5.2): el despliegue del 2026-11-14 falló en DermicaPro porque n8n guardó el mismo clic más de una vez con datos distintos y el índice no se pudo crear. La migración no toca `wsp_ad`; la captura nativa bloquea por clic (`pg_advisory_xact_lock`) y solo inserta si no existe. Los eventos siguen saliendo una vez por `event_key`. Limpiar los duplicados de n8n queda para cuando se apague `SUB - save CTWA` (§8 paso 4).
- **Un solo PR** para esquema y envío, en vez de los dos del §8: la función nace apagada igual.
- **Al encender** el panel ya pide el dataset (`POST /{WABA}/dataset`): si el token no trae el permiso, falla ahí y no se enciende. El worker lo vuelve a pedir solo si falta.

## Fuentes

- Meta, [Conversions API for Business Messaging: Onboarding Guide](https://developers.facebook.com/docs/marketing-api/conversions-api/business-messaging)
- Meta, [permisos de la plataforma de WhatsApp Business](https://developers.secure.facebook.com/documentation/business-messaging/whatsapp/permissions)
- Foro de Meta, [Declared Supported Event Types Returning as Unsupported](https://developers.secure.facebook.com/community/threads/1076478633997788)
- GitHub, [oussch702/whatsapp-conversions-api](https://github.com/oussch702/whatsapp-conversions-api) (códigos de error y libro mayor en producción)
- GitHub, [synckerja PR #74](https://github.com/octavialdidhanta/synckerja/pull/74) (del píxel al dataset de la WABA)
- Precisian, [ctwa_clid explained](https://precisian.io/blog/en/posts/ctwa-clid-explained/) · Konektor, [CTWA conversion tracking](https://konektor.id/en/docs/platform-guides/click-to-whatsapp) · CustomerLabs, [Chase chatters, not buyers](https://www.customerlabs.com/blog/why-meta-algorithm-chases-chatters-not-buyers-for-ctwa-ads) · Wati, [Track CTWA conversions](https://www.wati.io/en/blog/track-ctwa-conversions-capi/)
