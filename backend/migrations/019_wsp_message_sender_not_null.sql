-- Impide que n8n u otro productor externo vuelva a insertar mensajes sin
-- indicar si corresponden al cliente o al vendedor.
--
-- Si existen filas históricas incompletas, recuperarlas primero con:
--   python -m scripts.backfill_message_senders --apply

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM wsp_messages WHERE sender IS NULL) THEN
        RAISE EXCEPTION
            'No se puede aplicar NOT NULL: aún existen wsp_messages con sender NULL. Ejecute backfill_message_senders primero.';
    END IF;
END
$$;

ALTER TABLE wsp_messages
    ALTER COLUMN sender SET NOT NULL;
