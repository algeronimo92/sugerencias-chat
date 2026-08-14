# Cambios en el workflow de n8n para el modelo normalizado de mensajes

El workflow **"rag"** (exportado en `docs/rag.json`) es quien escribe los mensajes entrantes
directo en `wsp_messages`. Tras la migración `d4e8f1a2b6c9` (columnas `message_type`, `analysis`,
`payload`), hay que actualizarlo para que **deje de incrustar pseudo-tags y el bloque `Analisis:`
en `content`** y en su lugar llene las columnas nuevas. Estos cambios se aplican en el editor de
n8n; acá va el detalle nodo por nodo.

Contexto de compatibilidad: el frontend y el backend siguen entendiendo el formato viejo como
respaldo (`parseContent` legado, backfill), así que este cambio se puede aplicar antes o después
del backfill sin romper nada. Idealmente: migración → n8n (doble escritura) → backfill.

## 1. Nodo `Switch Control type`

Hoy rutea por `{{ $json.body.data.messageType }}` a: audio, image, text, video, sticker, document,
template, buttons, buttonsResponse, y `fallback: extra`. Problemas: `sticker`, `document` y el
fallback `extra` van todos a `text content1`; y no hay salidas para ubicación, contacto, encuesta
ni reacción.

Agregar reglas (salida propia) para:

| messageType de Evolution | Salida nueva |
|---|---|
| `locationMessage` | location |
| `contactMessage`, `contactsArrayMessage` | contact |
| `pollCreationMessage` | poll |
| `reactionMessage` | reaction |
| `stickerMessage` | sticker (hoy cae en text) |
| `documentMessage` | document (hoy cae en text) |

## 2. Nodos `* content*` (dejar de armar pseudo-tags)

Cada Set escribe columnas planas en vez de `<tag>…</tag>`. Campos de `wsp_messages` a mapear:
`content`, `message_type`, `analysis` (JSONB), `payload` (JSONB).

- **`text content1`**: `content` = texto puro (quitar los `'<text>' + … + '</text>'` y el hack
  `stickerMessage → '<image></image>'`); `message_type = 'text'`.
- **`image content1`**: `content` = `{{ …imageMessage.caption }}` (sin el prefijo ni el bloque
  Analisis); `message_type = 'image'`;
  `analysis = { "summary": {{ $('Analyze an image')…text }}, "kind": "descripcion", "model": "gemini", "generated_at": {{ $now.toISO() }}, "version": 1 }`.
- **`video content1`**: igual que image, `message_type = 'video'`, `analysis.summary` del nodo
  `Analyze video`.
- **`audio content1`**: `content` = null (o vacío); `message_type = 'audio'`;
  `analysis = { "summary": {{ $('Analyze audio')…text }}, "kind": "transcripcion", "model": "gemini", "generated_at": {{ $now.toISO() }}, "version": 1 }`
  (hoy el interior del `<audio>` es la transcripción — pasa a `analysis.summary`, no a `content`).
- **`template content`**: `content` = texto legible (título/opciones si se puede derivar, o null);
  `message_type = 'template'`; `payload` = el JSON de `interactiveMessageTemplate` (el que hoy
  incrustan en el tag).
- **`buttons content1`** (`buttonsMessage`): `content` = título/texto legible; `message_type =
  'interactive'`; `payload` = el JSON de `buttonsMessage`.
- **`buttons content`** (`buttonsResponseMessage`): `content` = `selectedDisplayText`;
  `message_type = 'interactive'`; `payload = { "selected_id": …selectedButtonId, "selected_text": …selectedDisplayText }`.

Nodos Set nuevos (una por salida agregada en el Switch):

- **location**: `content` = null; `message_type = 'location'`;
  `payload = { "latitude": …degreesLatitude, "longitude": …degreesLongitude, "name": …name, "address": …address }`.
- **contact**: `content` = null; `message_type = 'contact'`;
  `payload = { "contacts": [ { "fullName": …displayName, "phoneNumber": … } ] }`
  (para `contactsArrayMessage`, mapear el array `contacts`).

  El número **no** viene suelto en el mensaje: hay que sacarlo del `vcard`, prefiriendo el `waid`
  (formato internacional) sobre el valor visible del `TEL` (que suele ser local). Sin `phoneNumber`
  el CRM pinta el contacto pero no puede ofrecer abrirle el chat. El nodo `contact content` de hoy
  solo mapea `displayName`; el mapeo de contactos queda así:

  ```js
  const phoneOf = (c) => {
    const vcard = c.vcard || '';
    const waid = (vcard.match(/waid=(\d+)/i) || [])[1];
    const tel = (vcard.match(/^TEL[^:\r\n]*:(.*)$/im) || [])[1];
    return waid || (tel ? tel.trim() : null);
  };
  const entry = (c) => ({ fullName: c.displayName || 'sin nombre', phoneNumber: phoneOf(c) });
  const msg = $json.body.data.message || {};
  const base = msg.contactsArrayMessage
    ? { contacts: (msg.contactsArrayMessage.contacts || []).map(entry) }
    : { contacts: [entry(msg.contactMessage || {})] };
  ```

  (El frontend igual lee el `vcard` crudo si el payload lo trae, así que mandar el vCard tal cual
  dentro de cada contacto también sirve.)
- **poll**: `content` = `{{ …pollCreationMessage.name }}` (la pregunta); `message_type = 'poll'`;
  `payload = { "values": […options[].optionName], "selectableCount": …selectableOptionsCount }`.
- **reaction**: `content` = `{{ …reactionMessage.text }}` (el emoji); `message_type = 'reaction'`;
  `payload = { "target_wa_message_id": …reactionMessage.key.id }`.

Los campos comunes que ya setean (`timestamp`, `chat_id`, `message_id`, `status`, `last_sender`,
`quoted_wa_message_id`, etc.) no cambian.

## 3. Nodo `guardar mensajes en posgress1`

En el mapeo de columnas (modo "define below") agregar:

- `message_type` = `{{ $('chat input1').first().json.message_type }}`
- `analysis` = `{{ $('chat input1').first().json.analysis }}`
- `payload` = `{{ $('chat input1').first().json.payload }}`

(Asegurarse de que `chat input1` propague estos campos desde los nodos `* content*`.)

## 4. Nodos `get messages` / `get messages2` (contexto de los agentes IA)

Los agentes Copiloto/Analista leían el `content` viejo, que traía el análisis IA pegado. Al limpiar
`content`, hay que recomponer el texto para el LLM en el `SELECT` para que no pierda el contexto de
los adjuntos:

```sql
SELECT
  sender,
  sent_at,
  COALESCE(content, '') ||
    COALESCE(E'\n[Análisis IA] ' || (analysis->>'summary'), '') AS content,
  message_type
FROM wsp_messages
WHERE chat_id = $1
ORDER BY sent_at DESC
LIMIT ...
```

Así el agente sigue "viendo" la descripción de la imagen o la transcripción del audio, ahora
marcada explícitamente como análisis IA en vez de mezclada con el mensaje del cliente.

## Verificación

Tras aplicar los cambios, mandar por WhatsApp a la instancia: un texto, una imagen con caption, un
audio, un documento, una ubicación y (si se puede) una encuesta. Comprobar en la base que cada fila
nueva tiene `message_type` correcto, `content` limpio (sin `<tag>` ni `Analisis:`), y `analysis`/
`payload` poblados según el tipo. En la UI, la imagen debe mostrar solo el caption y el análisis en
el desplegable ✨.
