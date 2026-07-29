# Novedades de la rama 2.3.x relevantes a mensajería

Resumen del CHANGELOG entre 2.3.0 (2025-06-17) y 2.3.7 (2025-12-05). El repositorio migró de `EvolutionAPI/evolution-api` a `evolution-foundation/evolution-api`; la 2.4.0 está en release candidate desde mayo de 2026.

## Envío de mensajes

- **Quitar reacciones** (2.3.0): `sendReaction` con `reaction: ""` elimina la reacción.
- **Botón Pix** (2.3.7): tipo de botón `pix` manejado como mensaje interactivo.
- **Audio y video por Cloud API** (2.3.0): `sendWhatsAppAudio` y video soportados también en instancias oficiales, con arreglos posteriores de base64/`fileName`/`caption` (2.3.7).
- **Gestión de plantillas Meta** (2.3.7): endpoints nuevos para editar y borrar plantillas de WhatsApp Business.
- **Edición de mensajes** (2.3.0): refactor de `updateMessage` con webhook propio del evento de edición.

## Cosas que afectan a cómo recibimos/registramos mensajes

- **JIDs `@lid`** (2.3.5–2.3.7): múltiples arreglos para el formato nuevo de identidad de WhatsApp (`remoteJidAlt`, filtrado unificado con OR, enrutado de bots). Relevante para esta app: los webhooks pueden traer `remoteJid` terminado en `@lid` en lugar de `@s.whatsapp.net`.
- **Sincronización de historial** (2.3.7): el evento `messages.set` ahora trae `isLatest` y `progress`, útil para saber cuándo terminó el volcado de historial (la función de historial de la app hoy pagina con `chat/findMessages`).
- **Pérdida de mensajes por stubs** (2.3.7): los placeholders "Message absent from node" ya no pisan al mensaje real cuando llega descifrado.
- **Reconexión de Baileys** (2.3.7): arreglado que la instancia dejara de emitir eventos de mensajes entrantes tras reconectar, y el estado bloqueado "waiting for message".
- **Paginación** (2.3.0): `findChats` y `findContacts` con paginación; `findContacts` respeta todos los filtros del `where` desde 2.3.7.
- **Deduplicación** (2.3.7): índice único `(instanceId, remoteJid)` en `Chat` — ya no se duplican chats en la base de Evolution.

## Operativo

- Arreglos de proxy con `fetch` nativo de Node 18+ ("Media upload failed on all hosts"), de subida a MinIO con `messageContextInfo`, y de claves Redis huérfanas al desloguear una instancia.
