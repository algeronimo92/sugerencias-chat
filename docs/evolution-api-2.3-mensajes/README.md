# Análisis: estructuras de mensajes enviables — Evolution API 2.3.x

Análisis hecho contra el código fuente del tag **2.3.7** (última versión estable de la rama 2.3.x, publicada el 2025-12-05) del repositorio [evolution-foundation/evolution-api](https://github.com/evolution-foundation/evolution-api). El proyecto migró desde `EvolutionAPI/evolution-api`; existe una 2.4.0 en release candidate, pero 2.3.7 es la última estable.

Fuentes primarias (más fieles que la documentación web, que está desactualizada en varios campos):

- `src/api/dto/sendMessage.dto.ts` — estructuras (DTOs)
- `src/validate/message.schema.ts` — validación JSON Schema que realmente aplica el servidor
- `src/api/routes/sendMessage.router.ts` — endpoints expuestos
- `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` — cómo se consume cada campo

## Convenciones generales

- Todos los envíos son `POST {baseUrl}/message/<endpoint>/{instance}` con header `apikey: <clave>`.
- Respuesta `201 Created` con el mensaje generado por Baileys: `key` (con `id` = id del mensaje de WhatsApp, `remoteJid`, `fromMe`), `message`, `messageTimestamp` y `status` (`PENDING` al crear).
- `number` acepta el número pelado (`5215512345678`), el JID completo (`5215512345678@s.whatsapp.net`) o un JID de grupo (`...@g.us`). Esta app siempre manda el JID completo.
- Casi todos los cuerpos comparten un bloque de opciones (delay, quoted, menciones…): ver [opciones-comunes.md](opciones-comunes.md).

## Índice de endpoints

| Endpoint | Doc | Requeridos (según validación real) | ¿Lo usa la app? |
|---|---|---|---|
| `sendText` | [send-text.md](send-text.md) | `number`, `text` | ✅ `send_whatsapp_text` |
| `sendMedia` | [send-media.md](send-media.md) | `number`, `mediatype` (+ media o archivo) | ✅ `send_whatsapp_media` |
| `sendWhatsAppAudio` | [send-whatsapp-audio.md](send-whatsapp-audio.md) | `number` (+ audio o archivo) | ✅ `send_whatsapp_audio` |
| `sendPtv` | [send-ptv.md](send-ptv.md) | `number` (+ video o archivo) | ❌ |
| `sendSticker` | [send-sticker.md](send-sticker.md) | `number` (+ sticker o archivo) | ❌ |
| `sendLocation` | [send-location.md](send-location.md) | `number`, `latitude`, `longitude`, `name`, `address` | ✅ `send_whatsapp_location` |
| `sendContact` | [send-contact.md](send-contact.md) | `number`, `contact[]` | ❌ |
| `sendReaction` | [send-reaction.md](send-reaction.md) | `key`, `reaction` | ❌ |
| `sendPoll` | [send-poll.md](send-poll.md) | `number`, `name`, `selectableCount`, `values` | ❌ |
| `sendList` | [send-list.md](send-list.md) | `number`, `title`, `footerText`, `buttonText`, `sections` | ✅ `send_whatsapp_list` |
| `sendButtons` | [send-buttons.md](send-buttons.md) | `number` (+ `buttons[]` en la práctica) | ✅ `send_whatsapp_buttons` |
| `sendStatus` | [send-status.md](send-status.md) | `type` (+ destinatarios) | ❌ |
| `sendTemplate` | [send-template.md](send-template.md) | `name`, `language` — solo Cloud API oficial | ✅ `send_whatsapp_template` |

Las funciones de la columna derecha viven en `backend/services/evolution_service.py`.

## Novedades de la rama 2.3.x

Resumen de cambios relevantes a mensajería entre 2.3.0 y 2.3.7: [novedades-2.3.md](novedades-2.3.md).

## Endpoints relacionados (fuera del router de mensajes)

- `POST /call/offer/{instance}` — simula una llamada entrante (`number`, `isVideo`, `callDuration` 1–15 s).
- `POST /chat/updateMessage/{instance}` y `DELETE /chat/deleteMessageForEveryone/{instance}` — editar y borrar mensajes ya enviados.
- `POST /chat/markMessageAsRead/{instance}` — la app ya lo usa (`mark_messages_as_read`).
