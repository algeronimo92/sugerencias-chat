-- Relaciona cada mensaje saliente con los eventos MESSAGES_UPDATE de
-- Evolution API para mostrar enviado / entregado / leído en el chat.
ALTER TABLE wsp_messages
    ADD COLUMN IF NOT EXISTS wa_message_id TEXT,
    ADD COLUMN IF NOT EXISTS status TEXT;

CREATE INDEX IF NOT EXISTS idx_wsp_messages_wa_message_id
    ON wsp_messages(wa_message_id)
    WHERE wa_message_id IS NOT NULL;
