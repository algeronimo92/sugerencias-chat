# sendReaction — reacción a un mensaje

`POST /message/sendReaction/{instance}`

Único endpoint que **no** hereda las opciones comunes: no lleva `number`, el chat se identifica con `key.remoteJid`.

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `key` | object | ✅ | Identifica el mensaje a reaccionar. |
| `key.id` | string | ✅ | Id de WhatsApp del mensaje. |
| `key.remoteJid` | string | ✅ | JID del chat. |
| `key.fromMe` | boolean | ✅ | Si el mensaje reaccionado lo mandó la instancia. |
| `reaction` | string | ✅ | Emoji de la reacción. String vacío `""` la quita. |

## Ejemplo

```json
{
  "key": {
    "remoteJid": "5215512345678@s.whatsapp.net",
    "fromMe": false,
    "id": "BAE5F5A0C7D5E2B1"
  },
  "reaction": "👍"
}
```

## Quitar una reacción

```json
{
  "key": { "remoteJid": "5215512345678@s.whatsapp.net", "fromMe": false, "id": "BAE5F5A0C7D5E2B1" },
  "reaction": ""
}
```

## Notas

- Quitar reacciones con `""` funciona desde 2.3.0.
- Una reacción nueva sobre el mismo mensaje reemplaza a la anterior (comportamiento de WhatsApp).
- No usado por la app actualmente; encajaría con el modelo de mensajes existente porque ya se guardan los `wa_message_id`.
