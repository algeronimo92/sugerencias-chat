# Ediciones nativas de WhatsApp cifradas (`secretEncryptedMessage`)

Desde ~mayo 2026 WhatsApp cifra las ediciones hechas desde la app nativa (no desde el
CRM): en vez de un `protocolMessage` con el texto nuevo en claro, el webhook trae un
`secretEncryptedMessage` con `encPayload`/`encIv` y `targetMessageKey.id` apuntando al
mensaje original. Evolution API no lo descifra — sin este cambio cae en
`message_type = 'unsupported'` con `payload.original_type = 'secretEncryptedMessage'` (ver
el comentario en `backend/services/automation_rules.py`, que documenta este caso para el
motor de automatizaciones y **no cambia**: sigue siendo el fallback correcto cuando el
descifrado falla, p. ej. en mensajes de antes de este cambio).

El backend expone `POST /api/webhooks/message-edited-secret`, que descifra con el
`messageSecret` guardado del mensaje original (HKDF-SHA256 + AES-256-GCM, ver
`backend/services/message_edit_crypto.py`) y reutiliza el mismo pipeline de "Editado" que
el camino en claro (`POST /api/webhooks/message-edited`, ver
[edit-delete-message.md](evolution-api-2.3-mensajes/edit-delete-message.md)).

**Limitación:** solo sirve para ediciones que ocurran *después* de que el mensaje original
se haya guardado con este cambio ya aplicado. El `messageSecret` de un mensaje enviado antes
nunca se guardó, así que una edición sobre un mensaje viejo queda irrecuperable.

## Aplicado en `rag.json`

Ya está aplicado directamente sobre el workflow **"rag"** (export local, no se versiona —
ver `.gitignore`). Cubre **ambas** direcciones, porque un mensaje saliente (`fromMe: true`,
el bot/vendedor) pasa por el mismo Switch de tipos que uno entrante antes de separarse por
`last_sender` en el nodo `es saliente`:

1. **`text content`** (Set, rama `text`/`conversation` del Switch): agrega el campo
   `message_secret`, extraído de `message.messageContextInfo.messageSecret` y convertido al
   formato hex de Postgres (`\x...`). Solo esta rama — WhatsApp únicamente permite editar
   mensajes de texto.
2. **`chat input`** (Set con `includeOtherFields: true`, después del Switch): reafirma
   `message_secret` explícitamente, igual que ya hace con `payload`/`analysis`.
3. **`guardar mensajes en posgress`** (Postgres, camino entrante — `es saliente` = false):
   nueva columna `message_secret` en el schema y en el mapeo de valores. Esto persiste el
   secreto de los mensajes del **cliente**.
4. **`outgoing webhook1`** (HTTP → `/api/webhooks/outgoing`, camino saliente — `es saliente`
   = true): agrega `message_secret` al body, reconvirtiendo el hex de Postgres a base64 (el
   backend recibe JSON, no escribe directo a Postgres). Cubre los mensajes que manda el
   **bot/vendedor**. El backend (`reconcile_outgoing_message` en `db_service.py`) lo escribe
   sobre la fila que la propia app ya insertó al mandar el mensaje —esa fila no puede traer
   el secreto porque no lo conoce hasta que llega el eco de Evolution.
5. **`Switch Control type1`**: nueva regla `editedSecret` — detecta
   `messageType === 'secretEncryptedMessage'` con `secretEncType` de edición. Una captura
   real mostró `secretEncType: 2` (numérico), no el string `"MESSAGE_EDIT"` que usa la
   documentación de la comunidad de Baileys — la condición chequea `2`, `'2'` y
   `'MESSAGE_EDIT'` para no depender de un formato no confirmado del todo.
6. **Nodo nuevo `message edited secret webhook`**: POST a
   `https://chat.dermicapro.app/api/webhooks/message-edited-secret` con `chat_id`,
   `wa_message_id`, `sender_candidates` (prueba `participant`, `remoteJid` y `remoteJidAlt`
   — no hay forma de saber de antemano si WhatsApp derivó la clave con `@lid` o
   `@s.whatsapp.net`), `enc_payload` y `enc_iv` en base64. Reusa la credencial
   `X-Webhook-Token` que ya usan los demás webhooks del flujo. Conectado como la
   penúltima salida del Switch, justo antes del fallback `unsupported content`.

La respuesta de `message-edited-secret` es siempre `200 {"status": "ok", "matched": bool}`
— `matched: false` es esperado y normal (secreto no capturado, ningún candidato de sender
válido, mensaje no encontrado) y no debe tratarse como error ni reintentarse.

## Pendiente de verificar en vivo

`Buffer` no se usaba en ningún otro lado de este workflow antes de este cambio — el código
nuevo asume que está disponible en el sandbox de expresiones de esta instancia de n8n (es
estándar en versiones recientes). **Antes de confiar en esto en producción**, probar de
punta a punta:

1. Mandar un texto desde el CRM (saliente) y otro desde el cliente (entrante).
2. Confirmar en la base que ambas filas de `wsp_messages` quedaron con `message_secret` no
   nulo.
3. Editar cada uno desde WhatsApp nativo (no desde el CRM) y confirmar que la burbuja se
   actualiza sola con "Editado" — igual que cuando la edición llega en claro.
