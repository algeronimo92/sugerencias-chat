# Opciones comunes a todos los envíos

Todos los DTOs de envío (salvo `sendReaction`) heredan de `Metadata`:

| Campo | Tipo | Requerido | Descripción |
|---|---|---|---|
| `number` | string | ✅ | Número o JID de destino (`5215512345678`, `...@s.whatsapp.net`, `...@g.us`). |
| `delay` | integer | — | Milisegundos que la instancia simula "escribiendo/grabando" antes de enviar. |
| `quoted` | object | — | Cita a otro mensaje (respuesta). Ver abajo. |
| `linkPreview` | boolean | — | Genera vista previa de enlaces (solo tiene efecto en texto). |
| `mentionsEveryOne` | boolean | — | Menciona a todos los participantes del grupo. |
| `mentioned` | string[] | — | Números a mencionar (strings numéricos, sin `@`; el texto debe incluir `@<numero>`). |
| `encoding` | boolean | — | Control de conversión/encodificación de audio (ver send-whatsapp-audio.md). |
| `notConvertSticker` | boolean | — | No convertir la imagen a webp al mandar sticker. |

## Estructura de `quoted`

```json
{
  "quoted": {
    "key": { "id": "BAE5F5A0C7D5E2B1" },
    "message": { "conversation": "texto del mensaje citado" }
  }
}
```

- Lo único obligatorio es `key.id` (id de WhatsApp del mensaje a citar). `key.remoteJid` y `key.fromMe` son opcionales.
- `message` es opcional pero conviene mandarlo: Baileys lo usa para armar la vista previa de la cita.
- Enviar `"quoted": null` produce un 400 — hay que omitir la clave si no se cita (la app ya lo maneja en `_with_quoted`).

## Menciones: `mentionsEveryOne` vs `everyOne`

Los esquemas de validación (`message.schema.ts`) declaran un campo `everyOne`, pero el servicio de Baileys lee **`mentionsEveryOne`** del cuerpo. `everyOne` es un residuo del esquema y no tiene efecto: usar siempre `mentionsEveryOne`.

```json
{
  "number": "123456789-987654@g.us",
  "text": "Hola @5215512345678",
  "mentioned": ["5215512345678"]
}
```

## Envío como multipart (alternativa a base64/URL)

Los endpoints de media (`sendMedia`, `sendPtv`, `sendWhatsAppAudio`, `sendSticker`, `sendStatus`) aceptan además `multipart/form-data` con el binario en el campo **`file`** y el resto de campos como form fields. Útil para evitar inflar el JSON con base64 (~33 % de sobrepeso).

## Formato de respuesta (ejemplo de sendText)

```json
{
  "key": {
    "remoteJid": "5215512345678@s.whatsapp.net",
    "fromMe": true,
    "id": "BAE5F5A0C7D5E2B1"
  },
  "message": { "conversation": "Hola" },
  "messageTimestamp": "1753700000",
  "status": "PENDING"
}
```
