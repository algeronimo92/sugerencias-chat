-- Estado comercial de la conversación, separado de la ventana de 24 horas
-- de WhatsApp. Los leads existentes comienzan cerrados: su próximo mensaje
-- entrante abrirá la primera conversación versionada.
ALTER TABLE leads
    ADD COLUMN IF NOT EXISTS conversacion_abierta BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS conversacion_abierta_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS conversacion_cerrada_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS conversacion_version INTEGER NOT NULL DEFAULT 0;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'ck_leads_conversacion_version_nonnegative'
          AND conrelid = 'leads'::regclass
    ) THEN
        ALTER TABLE leads
            ADD CONSTRAINT ck_leads_conversacion_version_nonnegative
            CHECK (conversacion_version >= 0);
    END IF;
END $$;
