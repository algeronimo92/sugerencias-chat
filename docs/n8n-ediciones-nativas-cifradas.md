# Cambios en n8n para recuperar ediciones nativas de WhatsApp (`secretEncryptedMessage`)

Desde ~mayo 2026 WhatsApp cifra las ediciones hechas desde la app nativa (no desde el
CRM): en vez de un `protocolMessage` con el texto nuevo en claro, el webhook trae un
`secretEncryptedMessage` con `encPayload`/`encIv` y `targetMessageKey.id` apuntando al
mensaje original. Evolution API no lo descifra — hoy cae en `message_type = 'unsupported'`
con `payload.original_type = 'secretEncryptedMessage'` (ver el comentario en
`backend/services/automation_rules.py`, que documenta este caso para el motor de
automatizaciones y **no cambia**: sigue siendo el fallback correcto cuando el descifrado
falla).

El backend ya expone `POST /api/webhooks/message-edited-secret`, que descifra usando el
`messageSecret` guardado del mensaje original y reutiliza el mismo pipeline de "Editado"
que el camino en claro (`POST /api/webhooks/message-edited`, ver
[edit-delete-message.md](evolution-api-2.3-mensajes/edit-delete-message.md)). Lo que falta
del lado de n8n son dos cambios en el workflow **"rag"**.

**Limitación:** esto solo sirve para ediciones que ocurran *después* de aplicar el cambio 1.
El `messageSecret` de un mensaje ya enviado antes de este cambio nunca se guardó, así que
una edición sobre un mensaje viejo queda irrecuperable — igual que hoy.

## 1. Guardar `message.messageContextInfo.messageSecret` en cada mensaje nuevo

En el nodo `guardar mensajes en posgress1` (el mismo que en
[n8n-normalizacion-wsp-messages.md](n8n-normalizacion-wsp-messages.md) recibe `message_type`,
`analysis`, `payload`), agregar una columna más:

- `message_secret` = `{{ $json.body.data.message.messageContextInfo?.messageSecret ? Buffer.from($json.body.data.message.messageContextInfo.messageSecret, 'base64') : null }}`

`messageContextInfo` puede venir en cualquier tipo de mensaje (texto, imagen, lo que sea),
no solo en `extendedTextMessage` — conviene leerlo desde `$json.body.data.message` a secas,
no desde el contenido específico del tipo, para no tener que repetir el mapeo en cada rama
del Switch. Si el campo no viene (mensajes de tipos que WhatsApp no deja editar, versiones
viejas de Evolution, etc.) queda `NULL` y esa fila simplemente no podrá recuperar una
edición cifrada futura — no rompe nada.

Nota de formato: Evolution serializa los buffers como objeto indexado (`{"0": 12, "1": 8,
...}`), no como string. Si el nodo Postgres no acepta convertir eso directo a `bytea`, usar
un nodo Code antes con:

```js
const raw = $json.body.data.message?.messageContextInfo?.messageSecret;
const bytes = raw && typeof raw === 'object' && !Array.isArray(raw)
  ? Buffer.from(Object.keys(raw).sort((a, b) => +a - +b).map((k) => raw[k]))
  : (typeof raw === 'string' ? Buffer.from(raw, 'base64') : null);
return [{ json: { ...$json.json, message_secret_hex: bytes ? bytes.toString('hex') : null } }];
```

y en Postgres mapear `message_secret` = `decode({{ $json.message_secret_hex }}, 'hex')`
(o `NULL` si vino vacío).

## 2. Nueva rama para `secretEncryptedMessage` tipo `MESSAGE_EDIT`

En el nodo `Switch Control type` (el mismo de
[n8n-normalizacion-wsp-messages.md](n8n-normalizacion-wsp-messages.md#1-nodo-switch-control-type)),
agregar una regla:

- `messageType == 'secretEncryptedMessage'` **y**
  `message.secretEncryptedMessage.secretEncType == 'MESSAGE_EDIT'` (por si en el futuro
  WhatsApp usa el mismo sobre para otra cosa, p. ej. reacciones cifradas) → salida propia
  `edicion cifrada`, en paralelo a la rama `text`/`image`/etc., **no** hacia el fallback
  `extra` que hoy la manda a `unsupported`.

Esta rama no inserta una fila nueva en `wsp_messages` — llama al backend, igual que ya
hace la rama de edición en claro para `POST /message-edited`. Nodo HTTP Request nuevo:

```
POST {{ $env.CRM_BACKEND_URL }}/api/webhooks/message-edited-secret
```

Body:

```json
{
  "chat_id": "{{ /* mismo lookup de chat_id que usa la rama message-edited existente */ }}",
  "wa_message_id": "{{ $json.body.data.message.secretEncryptedMessage.targetMessageKey.id }}",
  "sender_candidates": [
    "{{ $json.body.data.key.participant || $json.body.data.key.remoteJid }}",
    "{{ $json.body.data.key.remoteJidAlt }}"
  ],
  "enc_payload_b64": "{{ /* encPayload convertido a base64, mismo truco de Buffer que arriba */ }}",
  "enc_iv_b64": "{{ /* encIv convertido a base64 */ }}"
}
```

`chat_id`: reusar exactamente el mismo nodo/lookup que ya resuelve `chat_id` para la rama
`message-edited` en claro (busca el lead por el JID del chat) — no duplicar esa lógica.

`sender_candidates`: no hay forma de saber de antemano si WhatsApp derivó la clave con el
JID `@lid` o con `@s.whatsapp.net`; el backend prueba cada candidato hasta que uno valide
(ver docstring de `message_edit_crypto` en el backend). Mandar como mínimo `remoteJid`
(o `participant` si viene, en grupos) y `remoteJidAlt` cuando exista — filtrar vacíos antes
de mandarlos, un array vacío hace que el backend no tenga nada que probar.

`enc_payload_b64` / `enc_iv_b64`: mismo problema de formato que `messageSecret` — convertir
con el mismo truco de `Buffer.from(Object.keys(...)...)` antes de pasar a base64.

La respuesta es siempre `200 {"status": "ok", "matched": bool}` — `matched: false` es
esperado y normal (secreto no capturado, candidato de sender no válido, mensaje no
encontrado en la base) y no debe frenar el workflow ni reintentarse como si fuera un error.

## Verificación

Para probar de punta a punta hace falta que el mensaje editado se haya **enviado después**
de aplicar el cambio 1 (si no, no tiene `message_secret` guardado). Desde el CRM o desde el
propio número de negocio: mandar un texto, esperar a que quede en `wsp_messages`, editarlo
desde WhatsApp nativo (no desde el CRM) y confirmar que la burbuja se actualiza sola con
"Editado" — igual que cuando la edición llega en claro.
