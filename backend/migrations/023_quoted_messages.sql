-- Responder a un mensaje en específico (cita estilo WhatsApp).
--
-- Respaldo manual de la revisión de Alembic c3f1d7a95b42; el despliegue la
-- aplica solo (ver backend/scripts/migrate.py). Se guarda el id de WhatsApp
-- del mensaje citado, no la clave primaria interna: es el único identificador
-- que comparten la app, Evolution y n8n.
--
-- Para que las respuestas del CLIENTE también se vean citadas, el workflow de
-- n8n tiene que rellenar esta columna con `contextInfo.stanzaId` del evento de
-- Evolution al insertar el mensaje entrante.

ALTER TABLE wsp_messages ADD COLUMN IF NOT EXISTS quoted_wa_message_id TEXT;

CREATE INDEX IF NOT EXISTS idx_wsp_messages_chat_wa_message
    ON wsp_messages(chat_id, wa_message_id);
