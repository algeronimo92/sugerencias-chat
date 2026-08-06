# updateMessage / deleteMessageForEveryone — editar y eliminar

Los dos viven en el **router de chat**, no en el de mensajes: no son envíos
nuevos, actúan sobre uno que ya existe. Por eso tampoco heredan las opciones
comunes (delay, quoted, menciones) de [opciones-comunes.md](opciones-comunes.md).

## Editar

`POST /chat/updateMessage/{instance}`

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `number` | string | ✅ | JID del chat (la app manda el JID completo). |
| `text` | string | ✅ | Texto nuevo. Reemplaza al anterior por completo. |
| `key` | object | ✅ | Identifica el mensaje a reescribir. |
| `key.id` | string | ✅ | Id de WhatsApp del mensaje. |
| `key.remoteJid` | string | ✅ | JID del chat (el mismo que `number`). |
| `key.fromMe` | boolean | ✅ | Siempre `true`: editar un mensaje ajeno no existe. |

```json
{
  "number": "5215512345678@s.whatsapp.net",
  "text": "Perdón, el precio correcto es 450",
  "key": {
    "remoteJid": "5215512345678@s.whatsapp.net",
    "fromMe": true,
    "id": "BAE5F5A0C7D5E2B1"
  }
}
```

Límites que pone WhatsApp (no Evolution):

- Solo mensajes **de texto**. Un epígrafe de imagen no se puede reescribir.
- Solo **dentro de los 15 minutos** posteriores al envío. Pasado ese margen la
  llamada puede responder 200 y aun así WhatsApp descarta la edición en
  silencio: el cliente sigue viendo el texto original. La app corta antes (ver
  `EDIT_MESSAGE_WINDOW` en `routers/chats.py`) justamente para no dar por buena
  una corrección que nadie vio.
- El `key.id` **no cambia** al editar: el mensaje sigue siendo el mismo, con
  la marca "Editado" del lado del receptor.

## Eliminar para todos

`DELETE /chat/deleteMessageForEveryone/{instance}`

Es un `DELETE` **con cuerpo**, y la key va desarmada en campos sueltos (no
anidada bajo `key` como en `sendReaction`).

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `id` | string | ✅ | Id de WhatsApp del mensaje. |
| `remoteJid` | string | ✅ | JID del chat. |
| `fromMe` | boolean | ✅ | Siempre `true` en un chat 1:1. |
| `participant` | string | ❌ | Solo en grupos: autor del mensaje borrado. |

```json
{
  "id": "BAE5F5A0C7D5E2B1",
  "remoteJid": "5215512345678@s.whatsapp.net",
  "fromMe": true
}
```

Aplica a cualquier tipo (texto, adjuntos, ubicación…) y no tiene la ventana de
15 minutos de la edición. En un chat 1:1 solo se pueden eliminar mensajes
propios: el "eliminar para todos" ajeno solo existe en grupos, y ahí únicamente
para administradores.

## Cómo lo usa la app

`backend/services/evolution_service.py`:

- `edit_whatsapp_message(chat_id, wa_message_id, text)`
- `delete_whatsapp_message(chat_id, wa_message_id)`

Las expone `PATCH` y `DELETE /api/chats/{chat_id}/messages/{message_id}`. El
orden importa: **primero WhatsApp, después la base**. Si Evolution falla, la
fila queda intacta y el endpoint responde 502 — un texto corregido o un mensaje
desaparecido solo de nuestro lado le haría creer al vendedor que el cliente ve
algo que en realidad no cambió.

El borrado en la base es lógico: `wsp_messages.deleted_at` marca la fila, la
API deja de servir contenido, adjunto y análisis (`_mask_deleted`), y el hilo
pinta la lápida. La edición guarda el texto vigente en `content` y la fecha en
`edited_at`; no se conservan versiones anteriores, igual que WhatsApp.

## Eventos entrantes

Cuando la edición o el borrado los hace el cliente —o el vendedor desde el
teléfono— WhatsApp manda un `protocolMessage` que apunta al mensaje original.
n8n los reenvía a `POST /api/webhooks/message-edited` y
`POST /api/webhooks/message-deleted` (ver el README) para que el CRM refleje lo
mismo que el teléfono.
