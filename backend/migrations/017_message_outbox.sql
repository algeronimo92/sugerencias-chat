-- Cola transaccional para desacoplar el request HTTP de Evolution API.
CREATE TABLE IF NOT EXISTS message_outbox (
    id SERIAL PRIMARY KEY,
    message_id BIGINT NOT NULL UNIQUE
        REFERENCES wsp_messages(id) ON DELETE CASCADE,
    chat_id TEXT NOT NULL
        REFERENCES leads(remote_jid) ON DELETE CASCADE,
    payload JSONB NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_message_outbox_pending
    ON message_outbox(status, next_attempt_at, id);

CREATE INDEX IF NOT EXISTS idx_message_outbox_chat_order
    ON message_outbox(chat_id, id);
