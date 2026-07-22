-- Mensajes de WhatsApp programados para un lead.
CREATE TABLE IF NOT EXISTS scheduled_messages (
    id BIGSERIAL PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(remote_jid) ON DELETE CASCADE,
    text TEXT NOT NULL,
    scheduled_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'scheduled',
    created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    queued_message_id BIGINT UNIQUE REFERENCES wsp_messages(id) ON DELETE SET NULL,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_due
    ON scheduled_messages(status, scheduled_at, id);

CREATE INDEX IF NOT EXISTS idx_scheduled_messages_lead
    ON scheduled_messages(lead_id, scheduled_at DESC);
