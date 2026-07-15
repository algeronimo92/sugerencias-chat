CREATE TABLE IF NOT EXISTS lead_notes (
    id BIGSERIAL PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(remote_jid) ON DELETE CASCADE,
    author_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_notes_lead_created
ON lead_notes(lead_id, created_at, id);

CREATE TABLE IF NOT EXISTS lead_note_mentions (
    note_id BIGINT NOT NULL REFERENCES lead_notes(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    read_at TIMESTAMPTZ,
    PRIMARY KEY (note_id, user_id)
);

ALTER TABLE lead_note_mentions
ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_lead_note_mentions_user
ON lead_note_mentions(user_id, created_at DESC);
