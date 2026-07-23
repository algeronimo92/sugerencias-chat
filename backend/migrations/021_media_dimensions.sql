-- Dimensiones de las imágenes adjuntas: el frontend reserva el espacio
-- exacto antes de que carguen, para que la conversación no se mueva.
--
-- El backend aplica esto de forma idempotente al arrancar (local y prod);
-- este archivo queda como respaldo manual. Los valores se calculan de forma
-- perezosa al servir cada página de mensajes (0/0 = no se pudo medir).

ALTER TABLE wsp_messages ADD COLUMN IF NOT EXISTS media_width INTEGER;
ALTER TABLE wsp_messages ADD COLUMN IF NOT EXISTS media_height INTEGER;
