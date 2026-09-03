# Plan: migrar la instancia de Baileys a WhatsApp Business (Meta Cloud API) vía Evolution

> Estado: propuesta para revisión. No se ha tocado código de producto todavía.
> Punto de partida: la app ya está verificada como **Tech Provider** de Meta, lo
> que habilita Embedded Signup. Se mantiene Evolution como capa de abstracción
> (integración `WHATSAPP-BUSINESS`, que internamente usa `BusinessStartupService`
> en vez de `BaileysStartupService`) en lugar de ir directo a la Graph API — ver
> el análisis de opciones que motivó esta decisión.

## 1. Objetivo

Reemplazar el transporte no oficial (Baileys/WhatsApp Web) de la instancia de
Evolution por el oficial (Meta Cloud API), aprovechando que Evolution ya
normaliza ambos proveedores detrás de la misma API REST y del mismo esquema de
webhooks. El código que ya consume esa API — [evolution_service.py](../backend/services/evolution_service.py),
la ingesta por RabbitMQ y el workflow `rag` de n8n — cambia lo mínimo posible;
lo que cambia es **qué hay detrás** de la instancia.

## 2. Supuesto crítico — confirmado leyendo el código fuente de Evolution

Se verificó contra el código fuente real de `whatsapp.business.service.ts` en
[evolution-foundation/evolution-api, tag 2.3.7](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/integrations/channel/meta/whatsapp.business.service.ts)
(no contra la documentación web, que está desactualizada — mismo criterio que
ya usa [docs/evolution-api-2.3-mensajes/README.md](evolution-api-2.3-mensajes/README.md)).

**Se confirma que sí normaliza** al mismo evento `MESSAGES_UPSERT` con la misma
forma que Baileys: `key.remoteJid` se construye con el mismo helper `createJid()`
que usa el canal Baileys, y termina en `@s.whatsapp.net` (líneas 397 y 750 de
ese archivo, `src/utils/createJid.ts`). No hay LID: una instancia Business
nunca produce `@lid`, así que `parse_evolution_identity` simplemente no
encuentra `remote_jid_alt`/`participant` y todo entra como `kind='phone'` — el
código de
[whatsapp_identity_service.py](../backend/services/whatsapp_identity_service.py)
ya tolera ese caso sin cambios.

**Diferencias concretas encontradas** (`messageHandle`, líneas 384-650 de ese
archivo), comparadas contra la taxonomía documentada en
[n8n-normalizacion-wsp-messages.md](n8n-normalizacion-wsp-messages.md), y
**confirmadas con tráfico real** en el spike del 2026-09-02 (instancia
`dermicapro-business`, número de prueba, 8 tipos probados en vivo — ver
sección 2.1):

| Tipo | `messageType` (Business) | Forma de `message.*` | Compatible con lo que espera `rag.json` hoy |
|---|---|---|---|
| Texto | `conversation` | `{conversation: texto}` | **Sí** — confirmado en vivo, idéntico a Baileys |
| Imagen/Audio/Documento | `imageMessage`/`audioMessage`/`documentMessage` | `message[type]` = objeto de Meta con `id`, `mime_type`, `sha256` **y `url`** (confirmado en vivo — mejor de lo que sugería el código a primera lectura) | **Sí, sin cambios** — la `url` es de `lookaside.fbsbx.com` (exige `Authorization: Bearer <token>` para descargarla directo, no es pública), pero `rag.json` no la toca: descarga la media vía el endpoint propio de Evolution `POST /chat/getBase64FromMediaMessage/{instance}` con la `apikey` de siempre, así que el matiz de autenticación queda resuelto adentro de Evolution, no en n8n |
| Sticker | `stickerMessage` | `{stickerMessage: message.sticker}` | No probado en vivo (no crítico), pero por código: **mejor que Baileys**, viene con su propio branch explícito — Baileys hoy cae al fallback `extra`/texto para stickers |
| Ubicación | `locationMessage` | `{locationMessage: {degreesLatitude, degreesLongitude}}` (sin `name`/`address` en una ubicación en vivo) | **Sí** — confirmado en vivo, coincide con lo que ya espera `location content` |
| Contacto | `contactMessage` | vCard armado a mano por Evolution, **confirmado en vivo con la convención `item1.TEL;waid=<wa_id>:<telefono>`** | **Sí** — confirmado en vivo, el parser de teléfono documentado en `n8n-normalizacion-wsp-messages.md` funciona sin cambios |
| Reacción | `reactionMessage` | `{reactionMessage: {key: {id: message_id}, text: emoji}}` | **Sí** — confirmado en vivo, idéntico a lo documentado |
| Respuesta a botón/lista (`interactive`) | `interactiveMessage` | `{conversation: "Opción A", contextInfo: {stanzaId: <wamid del mensaje de botones>}}` — **confirmado en vivo: texto plano, sin id** | **No.** Baileys entrega `buttonsResponseMessage` con `selectedButtonId` estructurado; Evolution en modo Business **descarta el id y solo deja el texto visible** (verificado con tráfico real el 2026-09-02). `rag.json` no tiene salida para `interactiveMessage`, cae al fallback `extra` — funciona como texto suelto. Único dato recuperable: `contextInfo.stanzaId` liga la respuesta al mensaje de botones original (sirve para saber *a qué* respondió, no *qué* opción eligió — eso solo se puede inferir comparando el texto contra las etiquetas de los botones enviados) |
| Botón rápido de plantilla (`button`) | `buttonMessage` | `{conversation: button.text}` | No probado en vivo, mismo patrón por código: texto plano, sin id |
| Encuesta, ubicación en vivo, sticker animado, fijar mensaje | — | no existen en este archivo | **N/A**, no es un bug: Meta Cloud API no expone estos tipos a terceros. No hace falta tocar esas ramas del Switch para instancias Business, pero tampoco hay que borrarlas — siguen sirviendo para instancias Baileys si conviven |

### 2.1 Registro del spike (2026-09-02)

Instancia de prueba `dermicapro-business` sobre el número de test de Meta,
inspeccionada con una cola temporal `q.wsp.spike` bindeada a `evolution_exchange`
(sin tocar `q.wsp.inbound` ni disparar el flujo real de n8n). 8/8 tipos
probados con tráfico real: texto, imagen con caption, audio (nota de voz),
documento, ubicación, contacto, reacción, y respuesta a un mensaje de botones
(`sendButtons`). Los 8 confirmaron la tabla de arriba. Cola de inspección
borrada al terminar.

**Acuses de estado** (`received.statuses`, líneas 746-810): Meta reporta
`sent`/`delivered`/`read`/`failed` en minúscula; Evolution los sube a mayúscula
tal cual (`item.status.toUpperCase()`) antes de emitir `MESSAGES_UPDATE`. Contra
[message_status_service.py](../backend/services/message_status_service.py):
`SENT`, `DELIVERED` y `READ` **ya están** en `_STATUS_ALIASES` — funcionan sin
tocar nada (probablemente puestos ahí pensando en esto mismo). **`FAILED` no
está mapeado** (`normalize_message_status` devuelve `None` para ese valor) y
tampoco existe un estado equivalente en el enum `MessageStatus` de
[domain_types.py](../backend/domain_types.py) — un mensaje rechazado por Meta
(número inválido, fuera de ventana de 24 h) hoy se descartaría en silencio en
vez de reflejarse como fallido en la UI. **Acción concreta para la Etapa 2**:
agregar `MessageStatus.FAILED` al enum y su alias en `_STATUS_ALIASES`.

Con esto, la Etapa 0 deja de ser "a ver qué pasa" y pasa a ser: reproducir en
vivo estos casos ya identificados para confirmar el análisis contra tráfico
real (sobre todo imagen/audio/documento y `interactive`), no para descubrir la
forma del payload desde cero. **Hecho — ver sección 2.1.**

## 3. Qué se mantiene igual y qué cambia (resumen)

| Área | Se mantiene | Cambia |
|---|---|---|
| Envío (`evolution_service.py`) | Mismos endpoints (`sendText`, `sendMedia`, `sendTemplate`, etc.) | `send_whatsapp_template` deja de estar bloqueada (`get_template_capabilities` ya detecta `WHATSAPP-BUSINESS`) |
| Audio saliente | — | **`sendWhatsAppAudio` (PTT) no funciona en esta instancia Business — bug real de Evolution 2.3.7, no de esta app** (`processAudio()` hardcodea `fileName`/`mimetype` como `.mp3`/`audio/mpeg` sin mirar el contenido real; confirmado en vivo — el mensaje se acepta con `201` y nunca progresa, `MessageUpdate: []` para siempre en el historial propio de Evolution). Reportado río arriba: [evolution-api#2719](https://github.com/evolution-foundation/evolution-api/issues/2719). El audio saliente ahora va por `send_whatsapp_media(mediatype="audio")` en vez de `send_whatsapp_audio` (eliminado de `evolution_service.py`); entrega bien, pero pierde la burbuja nativa de nota de voz — Evolution tampoco manda el `voice: true` que exige la Graph API para esa burbuja, en ningún camino de audio. Las notas de voz grabadas en el navegador también se convierten a Ogg/Opus antes de guardarse (`media_storage.transcode_audio_to_ogg_opus`), por las dudas de que Evolution algún día arregle el bug de arriba |
| Ingesta RabbitMQ (`mq/definitions.json`, `evolution_exchange`) | Topología completa — mismo evento `MESSAGES_UPSERT`, confirmado por código fuente | Nada |
| n8n (`rag.json`, `webhooks-evolution-rabbitmq.json`) | La lógica de negocio (agente analista, IA de adjuntos); el Switch para texto/ubicación/contacto/reacción/sticker/media — todo confirmado sin cambios, media incluida | El Code node de `interactiveMessage` ("priority interactive content") tiene un bug real con la forma de Business — hoy pierde hasta el texto, no solo el id (fix en Etapa 1); falta agregar `buttonMessage` (singular) al Switch |
| Identidad (`whatsapp_identity_service.py`) | El modelo de alias por lead sigue sirviendo | Ya no habrá `@lid` — todo entra como `kind='phone'`; el código lo tolera sin cambios, pero `resolve_history_jid` y `aliases_from_send_key` quedan sin propósito para esta instancia (documentar, no borrar mientras convivan instancias Baileys) |
| Historial (`find_chat_messages`, `chat/findMessages`) | — | **Se pierde.** Cloud API no expone historial retroactivo. Ninguna instancia Business puede traer mensajes previos a su conexión |
| Edición/borrado (`edit_whatsapp_message`, `delete_whatsapp_message`) | — | **Deja de funcionar.** Meta Cloud API no soporta editar ni "eliminar para todos" un mensaje saliente vía API |
| Mensajería libre | — | **Fuera de la ventana de 24 h desde el último mensaje del cliente, solo se pueden mandar plantillas aprobadas.** Cambio de UX para el vendedor |
| Stickers, reacciones, botones, listas | Soportado en ambos | Sin cambios funcionales relevantes |
| Onboarding | — | Deja de ser QR; pasa a ser Embedded Signup (Tech Provider) — resuelve el problema de fragilidad de [[whatsapp-qr-connect]] descrito en `multi-tenant-saas-plan.md` |

## 4. Etapas

### Etapa 0 — Spike de validación (no toca producción) — ✅ COMPLETA (2026-09-02)

Confirmado contra tráfico real, ver sección 2.1: los 8 tipos de mensaje
coinciden con lo previsto por el análisis de código, con dos matices nuevos
—la `url` de medios sí existe pero exige `Authorization: Bearer <token>`, y
`interactiveMessage` conserva `contextInfo.stanzaId`— que ya están
incorporados a la tabla de la sección 2 y a la Etapa 1 de abajo.

Registro de lo que hizo falta resolver en el camino, útil para la Etapa 5
(migración del número real), donde va a volver a pasar:

- **Bug de Evolution con tokens largos**: la columna `Instance.token` de la
  base propia de Evolution es `VARCHAR(255)`; un access token de Meta la
  excede y `POST /instance/create` falla con `P2000` ("too long for the
  column"). Solución aplicada: `ALTER TABLE "Instance" ALTER COLUMN "token"
  TYPE VARCHAR(1000)` en la base de Evolution. Es un cambio manual por fuera
  de las migraciones de Prisma — una futura actualización de Evolution podría
  revertirlo. Issue conocido: [evolution-foundation/evolution-api#1530](https://github.com/evolution-foundation/evolution-api/issues/1530).
- **No existe endpoint para actualizar el token de una instancia ya creada**
  (`instance.router.ts` solo tiene `create`/`restart`/`connect`/`connectionState`/
  `fetchInstances`/`logout`/`delete`). Si el token vence (los de prueba duran
  24 h), la única forma de renovarlo es `delete` + `create` de nuevo con el
  token fresco — no hay un `update` parcial.

<details>
<summary>Qué hacer (referencia, ya ejecutado)</summary>

**Qué hacer:**
1. En el Meta App Dashboard de la app Tech Provider: **WhatsApp → API Setup**. Ahí ya hay un número de prueba gratuito (no gasta cuota de plantillas) con su `phone_number_id`, `WABA id` y un botón para generar `access token` — no hace falta Embedded Signup para esto, ese flujo es para onboardear WABAs de terceros (Etapa 4).
2. Agregar tu propio celular en "Manage phone number list" y mandarte el `hello_world` desde ahí para confirmar que el número de prueba funciona antes de meter a Evolution en el medio.
3. Levantar una segunda instancia de Evolution, aparte de `dermicapro`, con `integration: "WHATSAPP-BUSINESS"` y esos tres datos:

   ```bash
   curl -X POST "https://evolution.dermicapro.online/instance/create" \
     -H "apikey: <EVOLUTION_ADMIN_APIKEY>" \
     -H "Content-Type: application/json" \
     -d '{
       "instanceName": "dermicapro-spike-business",
       "integration": "WHATSAPP-BUSINESS",
       "number": "<phone_number_id>",
       "businessId": "<WABA id>",
       "token": "<access token del número de prueba>",
       "qrcode": false
     }'
   ```

   **Ojo con el campo `number`**: pese al nombre, Evolution lo usa como
   segmento de URL para llamar a la Graph API (`{URL}/{version}/{number}/messages`,
   confirmado en `whatsapp.business.service.ts`) — tiene que ser el
   **`phone_number_id`** de la pantalla de API Setup, no el número en formato
   E.164. Es el error más común al armar este request.

4. No hace falta configurar el webhook a mano para que llegue a RabbitMQ: con `RABBITMQ_GLOBAL_ENABLED=true` (ya activo para `dermicapro`, ver [rabbitmq-ingesta-n8n-plan.md](rabbitmq-ingesta-n8n-plan.md)), **cualquier instancia nueva en ese mismo nodo de Evolution publica automáticamente en `evolution_exchange`** — es un exchange compartido por nodo, no por instancia. La única distinción entre instancias es el campo `instance` dentro de cada evento. Si se prefiere no mezclar tráfico de prueba con `q.wsp.inbound`, se puede sumar temporalmente `q.wsp.spike` con un binding al mismo exchange (que ya es `topic`) filtrando por ese campo en el primer nodo del workflow de prueba, sin tocar el binding real.
5. Mandar por WhatsApp, contra el número de prueba: texto, imagen con caption, audio, documento, ubicación, un contacto, una reacción y una respuesta a un botón/lista de una plantilla con botones.
6. Guardar cada payload crudo como fixture y confirmar contra la tabla de la sección 2: en particular, de qué campo sale la URL/base64 de los adjuntos, y qué le llega exactamente a `rag.json` para `interactiveMessage`.

**Listo cuando:** hay una carpeta de fixtures con los payloads reales, y la
tabla de la sección 2 quedó confirmada o corregida con datos reales.

</details>

### Etapa 1 — Ajustar n8n con lo que confirmó el spike — ✅ COMPLETA (2026-09-02)

Los dos cambios (Code node `priority interactive content` + regla `buttonMessage`
en `Switch Control type1`) se aplicaron al `rag.json` local, se importaron en n8n,
y se confirmó con tráfico real: una respuesta a un botón de plantilla ya guarda
el texto elegido en `wsp_messages` en vez de caer en `"Mensaje interactivo"`.

Sobre `rag.json` (ver [n8n-normalizacion-wsp-messages.md](n8n-normalizacion-wsp-messages.md)
como referencia del estado actual). Con el análisis de código como base, el
trabajo ya es concreto, no exploratorio:

- **Media (imagen/audio/video/sticker/ptv) — ⚠️ corregido (2026-09-03): sí
  hacía falta un cambio, no se detectó leyendo el código de n8n sino
  probando en vivo.** El endpoint propio de Evolution
  `POST {server_url}/chat/getBase64FromMediaMessage/{instance}` es correcto
  (la preocupación original sobre `Authorization: Bearer` a
  `lookaside.fbsbx.com` sigue sin aplicar), pero su **implementación tiene un
  contrato distinto entre Baileys y Business**, confirmado leyendo
  `whatsapp.baileys.service.ts` y `whatsapp.business.service.ts`:

  ```js
  // Baileys: si el body no trae el mensaje completo, lo busca por key
  const msg = m?.message ? m : (await this.getMessage(m.key, true));

  // Business: no busca nada — exige que el mensaje ya venga completo
  const messageType = msg.messageType.includes('Message') ? ... // revienta si no
  ```

  Los nodos `get audio`/`get image`/`get video`/`get sticker1`/`get ptv`
  mandaban solo `{"message.key.id": ...}` — alcanza para Baileys (busca el
  mensaje solo) pero en Business tira `400 Bad Request` /
  `TypeError: Cannot read properties of undefined (reading 'includes')`
  porque `msg.messageType` nunca llega poblado. **Fix aplicado**: los cinco
  nodos ahora mandan `{"message": {{ $json.body.data }}, "convertToMp4": false}`
  — el objeto completo del webhook en vez de solo la key — que sirve para los
  dos proveedores (a Baileys tampoco le hace falta la búsqueda si ya recibe
  `.message` poblado). **✅ Confirmado con tráfico real (2026-09-03)**: nota de
  voz genuina de un cliente → `get audio` devolvió
  `mimetype: "audio/ogg; codecs=opus"` (el formato real de una nota de voz de
  WhatsApp) y `Analyze audio1` (transcripción con Gemini) corrió sin errores.

  **Segundo bug, este sí bloqueante.** El workflow **sí** manda a analizar
  con Gemini los audios que manda el propio vendedor (no solo los del
  cliente): el `event: "send.message"`/`fromMe: true` pasaba por el mismo
  `get audio` → `Convert to audio` → `Analyze audio1`.
  `getBase64FromMediaMessage` en Business lee `mediaMessage?.mime_type` (con
  guion bajo), que funciona para un audio **entrante** (Evolution copia ese
  campo tal cual lo manda Meta) pero no para el **eco de un audio saliente**,
  cuya forma es distinta (`{fileName, mediaType, media, id, type, mimetype}`
  — sin guion bajo) — ahí `mime_type` da `undefined` y Gemini rechaza el
  archivo. Es un bug de Evolution, no se puede corregir ahí.

  **Decisión de producto (2026-09-03): en vez de arreglar el mimetype para
  el eco saliente, directamente no se manda a Gemini el audio del vendedor
  — no hace falta transcribir lo que el propio vendedor dijo.** Nodo nuevo
  **`es audio del vendedor`** (IF), insertado entre `Convert to audio` y
  `Analyze audio1`, evaluando
  `$('set files').item.json.parsed.last_sender === 'vendedor'`: si es
  vendedor salta directo a `upload audio media` (el audio se sigue subiendo
  y queda con `media_url`, solo no se transcribe); si es cliente sigue igual
  que antes por `Analyze audio1`. El campo `analysis` de `audio content` pasó
  a ser condicional (`null` para vendedor, el resumen de Gemini para
  cliente) — sin eso, referenciar `$('Analyze audio1')` para un item que
  nunca pasó por ese nodo rompe la ejecución.

  El fix del `mimetype` con fallback en `Convert to audio` (descrito antes)
  se dejó igual: ya no hace falta para el caso del vendedor porque ese
  camino ni siquiera llega a necesitar el mimetype para Gemini, pero no
  molesta dejarlo — es una mejora general de robustez del nodo.

  Pendiente de confirmar con un audio real del vendedor tras el fix (que ya
  no dispare `Analyze audio1` en absoluto).

  **Extendido a imagen, video y ptv (2026-09-03) — mismo patrón, a pedido.**
  El mismo problema de fondo aplica a cualquier adjunto que el vendedor
  manda: no hace falta que Gemini describa una imagen o video que mandó el
  propio vendedor, y el bug del `mimetype` del eco saliente probablemente
  afecta a esos tipos también (no confirmado caso por caso, pero la forma
  del eco es la misma familia de problema). Se replicó la misma solución en
  los tres caminos restantes:

  | Tipo | Nodo IF nuevo | Salta a (vendedor) | Sigue a (cliente) |
  |---|---|---|---|
  | Imagen | `es imagen del vendedor` | `upload image media` | `Analyze an image1` |
  | Video | `es video del vendedor` | `upload video media` | `Analyze video1` |
  | PTV (video nota) | `es ptv del vendedor` | `upload ptv media` | `Analyze ptv1` |

  Cada IF va entre el `Convert to <tipo>` correspondiente y su nodo
  `Analyze`, con la misma condición
  (`$('set files').item.json.parsed.last_sender === 'vendedor'`). Los
  `analysis` de `image content`/`video content`/`ptv content` pasaron a ser
  condicionales con el mismo patrón que `audio content`. En los cuatro casos
  el adjunto se sigue subiendo y queda con `media_url` — solo se salta el
  análisis de Gemini.

  Nota sobre nombres engañosos en el workflow: el nodo que convierte la
  **imagen** se llama `Convert to audio4` (no `Convert to image`) — quedó
  documentado acá para que no confunda a quien lo retome.

  Pendiente de confirmar los tres con tráfico real del vendedor.
- **`Switch Control type1` — `interactiveMessage` ya tiene salida, pero con un
  bug real de compatibilidad.** El Switch agrupa `interactiveMessage` junto con
  listas y respuestas de plantilla bajo la salida `priorityInteractive`, y el
  Code node **"priority interactive content"** la procesa — pero asume la
  forma anidada de Baileys (`message.interactiveMessage.selectedDisplayText`).
  Con el payload real de Business (`message.conversation` plano, sin anidar,
  confirmado en el spike), `value = message[messageType]` da `{}`, y `content`
  cae en el string fijo `'Mensaje interactivo'` — **se pierde hasta el texto
  visible, no solo el id**. Fix: agregar al principio del código del nodo una
  rama para `messageType === 'interactiveMessage' && typeof message.conversation
  === 'string' && !message[messageType]` que arme el resultado directo desde
  `message.conversation` (con `selected_id: null` y `quoted_wa_message_id`
  desde `message.contextInfo.stanzaId`, no `value.contextInfo.stanzaId`). No
  afecta el camino de Baileys porque esa condición nunca se cumple ahí.
- **`buttonMessage` (singular, clic en quick-reply button de una plantilla
  aprobada — distinto del `interactiveMessage` ya cubierto): resuelto con el
  mismo fix.** Por código fuente (`messageButtonJson` en
  `whatsapp.business.service.ts`), produce la misma forma plana
  (`{conversation: texto, contextInfo: {stanzaId}}`) que `interactiveMessage`.
  Dos cambios: (a) agregar `buttonMessage` como condición más (`OR`) dentro de
  la misma regla del Switch que ya agrupa `listMessage`/`interactiveMessage`/etc.
  bajo la salida `priorityInteractive`; (b) en el Code node "priority
  interactive content", extender la condición de la rama Business a
  `(messageType === 'interactiveMessage' || messageType === 'buttonMessage')`.
  No requiere ningún nodo nuevo. **No probado en vivo** (no se generó tráfico
  real de este tipo en el spike) — queda para verificar cuando haya una
  plantilla con quick-reply buttons a mano.
- **`contact content`**: no necesita cambios — confirmado en el spike, el
  vCard que arma Evolution en modo Business usa la misma convención
  `item1.TEL;waid=…` que ya parsea el regex documentado.
- **Acuses de estado** (`q.wsp.status`): no necesita cambios en n8n — el ajuste
  real va en el backend (`message_status_service.py`, Etapa 2), agregando
  `FAILED` al mapeo.

**Listo cuando:** los 8 tipos de mensaje del spike (sección 2.1) producen las mismas columnas en `wsp_messages` que producirían viniendo de Baileys.

### Etapa 2 — Backend: identidad y ventana de 24 h

1. **Identidad.** No se necesita código nuevo si el spike confirma que Evolution entrega `remoteJid` con sufijo `@s.whatsapp.net` — `parse_evolution_identity` y `resolve_whatsapp_identity` ya tratan cualquier JID sin sufijo `@lid` como `kind='phone'` sin rama especial. Sí hay que **documentar** que para instancias Business, `resolve_history_jid` y `aliases_from_send_key` (pensados para el caso `@lid`) son no-ops benignos, no bugs.
2. **Ventana de 24 h — ✅ HECHO, con un rediseño respecto a lo planteado
   arriba (2026-09-02).** La idea original era derivar "¿está abierta la
   ventana?" de `wsp_messages` (último entrante < 24h) y bloquear el envío
   preventivamente. Se descartó: es exactamente el riesgo que puede fallar
   si la ingesta no registró bien un entrante (RabbitMQ caído, n8n
   desactivado, etc.) — bloquearía un envío que Meta sí aceptaría. Meta ya es
   la fuente de verdad y lo dice en el momento: el error 131047 ("Re-engagement
   message") viene en la respuesta **síncrona** del propio POST a `/messages`
   cuando la ventana está cerrada.

   El problema real, encontrado leyendo `whatsapp.business.service.ts`: el
   helper `post()` de Evolution atrapa el error de axios y devuelve el
   objeto de error de Meta **con el mismo HTTP 200/201 que un envío
   exitoso** — nunca relanza el error. Sin corregir esto, un rechazo por
   ventana cerrada pasaba como envío exitoso, sin `wa_message_id` real y sin
   ningún error visible.

   Arreglado en [evolution_service.py](../backend/services/evolution_service.py):
   `_raise_if_send_rejected()` valida la *forma* de la respuesta (un envío
   real siempre trae `key.id`; el error de Meta trae `code` int + `message`
   string en su lugar, nunca los dos a la vez que un envío real) y la
   convierte en `WhatsAppWindowClosedError` (para 131047, con mensaje
   accionable) o `EvolutionApiError` genérico (cualquier otro rechazo de
   Meta). Enganchado en `_post_to_chat`, el punto único por el que pasan
   todos los envíos a un chat (texto, media, audio, ubicación, sticker,
   plantillas, botones, listas). Tests nuevos en `test_evolution_client.py`.

   **Nota:** `send_whatsapp_reaction` y `edit_whatsapp_message` no pasan por
   `_post_to_chat` (van por `_post` directo) y quedan **sin esta protección**
   todavía — menor prioridad porque el peor caso es perder una reacción, no
   un mensaje, y `edit_whatsapp_message` ya no aplica a instancias Business
   (Meta no soporta editar). Pendiente si hace falta blindarlos igual.

   **Corregido — ✅ HECHO (2026-09-02): el texto real ya llega a la burbuja.**
   Los envíos normales pasan por el outbox (`message_outbox.py`), no por una
   respuesta HTTP síncrona, así que `WhatsAppWindowClosedError` no llega
   directo al router — el outbox lo atrapa como cualquier excepción y lo
   guarda en `MessageOutbox.last_error` (`_mark_failed`), con el mensaje
   quedando en `WspMessage.status = 'FAILED'`. Hasta acá la UI solo mostraba
   "No enviado · Reintentar" genérico, sin importar el motivo real.

   Se agregó `error_detail` de punta a punta: `fetch_messages` en
   [db_service.py](../backend/services/db_service.py) hace un `outerjoin`
   contra `MessageOutbox.last_error` (solo se expone cuando
   `status == 'FAILED'`; para cualquier otro estado o un reintento que ya
   limpió `last_error`, viaja `None`); el schema `Message` y el tipo
   `Message` del frontend lo incluyen; `MessageStatusTicks` en
   [MessageBubble.tsx](../frontend/src/components/MessageBubble.tsx) lo usa
   como `title`/`aria-label` del botón "Reintentar" en vez del genérico —el
   rótulo compacto no cambia, tiene que caber al lado de la hora, pero el
   tooltip ahora sí explica el motivo real ("La ventana de 24h... está
   cerrada. Mandale una plantilla...").

   Probado con una fila sintética contra Postgres real (`docker compose up
   postgres` + `db_service.fetch_messages` directo): el `last_error` del job
   viaja correcto hasta el `dict` que sirve la API. Tests nuevos en
   `MessageBubble.test.tsx`.

   **Lo que sigue faltando** (alcance mayor, no entra acá): que el composer
   ofrezca activamente "mandar plantilla" al toparse con esto, en vez de que
   el vendedor tenga que leer el tooltip y saber que existe esa opción.
3. **Capacidades por instancia — ✅ backend hecho (2026-09-02), frontend
   pendiente.** `get_template_capabilities()` se generalizó a
   `get_instance_capabilities()` en
   [evolution_service.py](../backend/services/evolution_service.py): misma
   llamada a Evolution (`GET /instance/fetchInstances`, mismo cache de 5 min),
   ahora devuelve también `history_available` y `edit_delete_supported`
   (`True` solo cuando la integración es Baileys confirmada — si no se pudo
   determinar la integración, las tres banderas quedan restrictivas en vez de
   asumir "todo menos Business" por default). Actualizados todos los
   llamadores (`send_whatsapp_template`, `message_outbox.py`,
   `routers/templates.py`) y el schema `TemplateCapabilities`
   (backend + frontend) con los dos campos nuevos. Tests nuevos en
   `test_evolution_client.py` cubriendo Business, Baileys, e integración
   desconocida.

   **✅ HECHO (2026-09-03).** `MessageBubble.tsx` recibe ahora
   `editDeleteSupported?: boolean` (prop opcional, default `true` para no
   hacer parpadear los botones mientras se resuelve la capacidad — hoy casi
   todo el tráfico real sigue siendo Baileys) y lo usa para tapar
   `canEdit`/`canDelete` en la raíz. `ChatThread.tsx` lo alimenta
   reutilizando `useTemplateCapabilities()` (mismo hook que ya usaba el
   picker de plantillas oficiales, mismo dato — no hizo falta un hook nuevo).
   `/history/availability` en `chats.py` ahora usa
   `get_instance_capabilities()["history_available"]` en vez de
   `is_configured()`. Tests nuevos: `test_history_availability_route.py`
   (backend) y un caso nuevo en `MessageBubble.test.tsx` (frontend).
4. **Estado de rechazo — ✅ HECHO (2026-09-02).** Se agregó `MessageStatus.REJECTED`
   (no `FAILED`: ese valor ya lo usa el outbox para un envío que nunca salió y
   admite reintento/descarte — acá el mensaje sí tiene `wa_message_id`, así que
   "reintentar" significaría mandar uno nuevo, no reactivar un job). El
   `"failed"` que manda Meta se mapea a `REJECTED` en `_STATUS_ALIASES`
   ([message_status_service.py](../backend/services/message_status_service.py)).
   Se corrigió también `update_message_status` en
   [db_service.py](../backend/services/db_service.py), que tiene su **propio**
   mapa de rangos duplicado (bug latente: sin esto, un `REJECTED` se habría
   descartado en silencio ahí, no solo en el de-dup de lotes). Frontend:
   `MessageStatus` incluye `'REJECTED'` y `MessageBubble.tsx` lo pinta como
   "No entregado" sin botones de acción. Tests nuevos en
   `test_message_status_service.py`.

### Etapa 3 — RabbitMQ / ingesta — ✅ COMPLETA, confirmado por código fuente (2026-09-03)

Se confirma que **no hay nada que tocar** en [mq/definitions.json](../mq/definitions.json) ni en `mq/provision.sh`. Verificado leyendo
[`rabbitmq.controller.ts`](https://github.com/evolution-foundation/evolution-api/blob/2.3.7/src/api/integrations/event/rabbitmq/rabbitmq.controller.ts)
de Evolution 2.3.7 (no se pudo probar contra el RabbitMQ real: el puerto de
administración (10.10.0.1:15672) no tiene ruta desde este entorno de
desarrollo local, mismo caso que Postgres — ver
[[entorno-local-apunta-a-bd-produccion]]):

- `emit()` no tiene **ninguna** rama condicionada por tipo de canal
  (Baileys/Business) — el único filtro por `integration` que existe ahí es
  sobre la lista de integraciones de eventos habilitadas por instancia
  (`"rabbitmq"` como string dentro de esa lista), no sobre el proveedor de
  WhatsApp.
- En modo **global** (`RABBITMQ_GLOBAL_ENABLED=true`, el que ya usa
  `dermicapro`), el exchange y las routing keys son siempre los globales
  (`rabbitmqExchangeName`/el nombre del evento tal cual, ej. `messages.upsert`)
  — nunca el nombre de la instancia. Una instancia Business en modo global
  publica exactamente al mismo `evolution_exchange`, con las mismas routing
  keys, que una Baileys. Solo el modo **local** (`instanceRabbitmq.enabled`
  activado a mano para esa instancia puntual) crea un exchange nombrado con
  el `instanceName` — no es el modo que usa esta app, así que no aplica.
- `groupsIgnore` es una bandera exclusiva de `whatsapp.baileys.service.ts`
  (filtra mensajes de grupos de WhatsApp Web) — no existe en
  `whatsapp.business.service.ts` porque Meta Cloud API no tiene ese concepto
  para terceros. No es una discrepancia a resolver, es simplemente N/A para
  Business.

**Conclusión:** mientras la instancia Business nueva no tenga su propio
`Rabbitmq.enabled` local activado (dejarlo como está, sin tocar), va a
publicar a `q.wsp.inbound`/`q.wsp.status` exactamente igual que `dermicapro`
hoy, sin colas ni exchanges huérfanos. No hace falta un spike con tráfico
real para esta etapa: el código no deja margen para un comportamiento
distinto entre canales acá.

### Etapa 4 — Encaje con el pivot multi-tenant

Esto es lo que conecta con `multi-tenant-saas-plan.md`: hoy la Etapa 2 de ese
plan asume "cada org vincula su WhatsApp por QR" (Baileys). Con Tech Provider
ya verificado, conviene **reemplazar esa etapa** por Embedded Signup:

- El "provisioning al vincular" deja de ser `POST /instance/create` con QR y
  pasa a ser: el usuario completa el signup embebido de Meta en el frontend →
  la app recibe `waba_id`/`phone_number_id`/`access_token` → se crea la
  instancia de Evolution con `integration: WHATSAPP-BUSINESS` y esas
  credenciales → se registra el webhook de esa instancia contra el mismo
  `evolution_exchange`.
- No hace falta decidir esto ahora mismo, pero si se confirma, la Etapa 2 del
  plan multi-tenant se simplifica: no hay pantalla de QR ni polling de estado
  de conexión, es un callback de OAuth.

**Recomendación:** usar Meta Cloud API como el camino de onboarding para
**organizaciones nuevas** del modelo multi-tenant, y decidir aparte (Etapa 5)
si el número de producción actual migra o queda en Baileys.

### Etapa 5 — Migración del número de producción (la más riesgosa, al final)

Recién después de que las etapas 0-3 estén validadas con un número de prueba:

1. Confirmar con Meta si el número actual puede registrarse en Cloud API
   manteniendo el historial de WhatsApp del lado del cliente (el historial del
   CRM en Postgres no se pierde nunca; lo que no se puede traer es lo que
   Evolution podría haber sincronizado retroactivamente de Baileys).
2. Registrar el número vía el flujo oficial de Meta (verificación SMS/voz).
   **Punto sin retorno:** una vez migrado a Cloud API, ese número deja de
   poder usarse desde la app de WhatsApp normal salvo que se use el feature de
   coexistencia de Meta (requiere la app oficial de WhatsApp Business, no
   Baileys) — confirmar disponibilidad y alcance exacto en ese momento, no
   asumirlo de este documento.
3. Ventana de corte: apagar la instancia Baileys, crear la instancia Business
   con las credenciales del número migrado, verificar que entra tráfico real
   por `q.wsp.inbound` antes de anunciar el cambio a los vendedores.
4. Comunicar a los vendedores, **antes** del corte: pierden edición/borrado de
   mensajes propios, y fuera de la ventana de 24 h el primer mensaje a un lead
   frío tiene que ser una plantilla aprobada, no texto libre.

## 5. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El análisis de código (sección 2) no coincide con el comportamiento real (versión distinta, S3/`webhookBase64` mal configurado, etc.) | Etapa 0 lo confirma con fixtures antes de tocar nada real; el costo de estar equivocado se paga en fixtures, no en producción |
| Se pierde la capacidad de editar/borrar mensajes que los vendedores ya usan | Comunicar antes del corte (Etapa 5.4); ocultar los botones para instancias Business (Etapa 2.3) en vez de dejarlos fallar |
| Un vendedor intenta escribir a un lead frío fuera de la ventana de 24 h y el mensaje falla en silencio | Backend devuelve error explícito + frontend ofrece plantilla (Etapa 2.2) |
| El número de producción queda inutilizable en la app normal de WhatsApp tras migrar | Confirmar coexistencia con Meta antes de la Etapa 5; hasta entonces, todo el spike corre sobre un número de prueba nuevo, nunca el de producción |
| Las colas huérfanas / `groupsIgnore` de Evolution se comportan distinto en modo Business | Validar en la Etapa 3 antes de asumir que la topología de RabbitMQ no cambia |

## 6. Qué NO hace falta tocar

- El outbox transaccional (`message_outbox.py`) y su modelo de idempotencia:
  siguen funcionando igual, sea Baileys o Business, porque el POST a Evolution
  no cambia de forma.
- La ingesta de acuses de estado por `q.wsp.status`, salvo la posible
  normalización de códigos mencionada en la Etapa 1.
- Nada del plan de [rabbitmq-eventos-plan.md](rabbitmq-eventos-plan.md) (mover
  la persistencia al backend): es ortogonal a este cambio y puede avanzar en
  paralelo o después, sin que uno bloquee al otro.
