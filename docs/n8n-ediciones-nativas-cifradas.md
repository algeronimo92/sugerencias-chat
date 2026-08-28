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

1. **`calcular message_secret`** (Code node, entre el Switch y `text content`): extrae
   `message.messageContextInfo.messageSecret` y lo convierte al formato hex de Postgres
   (`\x...`), devolviendo el item completo (`...input`) más ese campo agregado. Está en un
   Code node y no en la expresión del Set (ver "Historial de bugs" abajo) porque el sandbox
   de expresiones de esta instancia no ejecuta con fiabilidad IIFEs con `Buffer` adentro.
2. **`text content`** (Set, rama `text`/`conversation` del Switch): `message_secret` es
   ahora una referencia trivial (`={{ $json.message_secret }}`) al campo que ya vino
   calculado del Code node anterior. Solo esta rama — WhatsApp únicamente permite editar
   mensajes de texto.
3. **`chat input`** (Set con `includeOtherFields: true`, después del Switch): reafirma
   `message_secret` explícitamente, igual que ya hace con `payload`/`analysis`.
4. **`guardar mensajes en posgress`** (Postgres, camino entrante — `es saliente` = false):
   nueva columna `message_secret` en el schema y en el mapeo de valores. Esto persiste el
   secreto de los mensajes del **cliente**.
5. **`outgoing webhook1`** (HTTP → `/api/webhooks/outgoing`, camino saliente — `es saliente`
   = true): agrega `message_secret` al body, reconvirtiendo el hex de Postgres a base64 (el
   backend recibe JSON, no escribe directo a Postgres). Cubre los mensajes que manda el
   **bot/vendedor**. El backend (`reconcile_outgoing_message` en `db_service.py`) lo escribe
   sobre la fila que la propia app ya insertó al mandar el mensaje —esa fila no puede traer
   el secreto porque no lo conoce hasta que llega el eco de Evolution.
6. **`Switch Control type1`**: nueva regla `editedSecret` — detecta
   `messageType === 'secretEncryptedMessage'` con `secretEncType` de edición. Una captura
   real mostró `secretEncType: 2` (numérico), no el string `"MESSAGE_EDIT"` que usa la
   documentación de la comunidad de Baileys — la condición chequea `2`, `'2'` y
   `'MESSAGE_EDIT'` para no depender de un formato no confirmado del todo.
7. **`preparar edicion cifrada`** (Code node, entre el Switch y el HTTP de abajo): arma
   `chat_id`, `wa_message_id`, `sender_candidates` y `enc_payload`/`enc_iv` en base64. Los
   candidatos de sender incluyen `participant`/`remoteJid`/`remoteJidAlt` del sobre del
   evento **y también** los mismos campos de `targetMessageKey` — una ejecución real
   pineada mostró que el `remoteJid` del sobre puede no coincidir con el de
   `targetMessageKey` (identidades `@lid` inconsistentes), así que probar solo uno de los
   dos se queda corto.
8. **`message edited secret webhook`**: POST a
   `https://chat.dermicapro.app/api/webhooks/message-edited-secret` con los campos que ya
   armó el Code node anterior (expresión trivial, sin lógica). Reusa la credencial
   `X-Webhook-Token` que ya usan los demás webhooks del flujo. Conectado como la
   penúltima salida del Switch, justo antes del fallback `unsupported content`.

La respuesta de `message-edited-secret` es siempre `200 {"status": "ok", "matched": bool}`
— `matched: false` es esperado y normal (secreto no capturado, ningún candidato de sender
válido, mensaje no encontrado) y no debe tratarse como error ni reintentarse.

## Historial de bugs encontrados al probar en vivo

- **Expresiones con `Buffer` + IIFE evaluaban a `undefined`** tanto en el campo "JSON Body"
  de `message edited secret webhook` como en la asignación `message_secret` de
  `text content`. El código era JS válido (se probó fuera de n8n con Node y funcionaba),
  pero el sandbox de expresiones de esta instancia (n8n 2.31.6 self-hosted) no lo ejecutaba
  bien. Solución: mover todo cálculo no trivial a un Code node (`n8n-nodes-base.code`, que
  corre en una VM de Node real) y dejar en los campos de expresión solo referencias planas
  a `$json.algo`. Si se agrega lógica nueva en este flujo, seguir ese mismo patrón — no
  repetir IIFEs con `Buffer` directo en un campo `={{ }}`.
- **`matched: false` en una prueba real resultó ser esperado**: el mensaje editado
  (`targetMessageKey.id`) era uno enviado *antes* de aplicar el cambio 1, así que
  `message_secret` estaba `NULL` en esa fila — no hay nada que descifrar. Antes de asumir un
  bug, confirmar con SQL que la fila objetivo tiene `message_secret IS NOT NULL`:
  ```sql
  SELECT wa_message_id, content, message_secret IS NOT NULL AS tiene_secreto
  FROM wsp_messages ORDER BY id DESC LIMIT 5;
  ```

## Verificación

1. Mandar un texto desde el CRM (saliente) y otro desde el cliente (entrante), **después**
   de reimportar el workflow con estos cambios.
2. Confirmar con la consulta SQL de arriba que ambas filas nuevas de `wsp_messages` quedaron
   con `message_secret` no nulo.
3. Editar cada uno desde WhatsApp nativo (no desde el CRM) y confirmar que la burbuja se
   actualiza sola con "Editado" — igual que cuando la edición llega en claro.
