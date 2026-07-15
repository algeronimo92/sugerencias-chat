CREATE TABLE IF NOT EXISTS template_attachments (
    id SERIAL PRIMARY KEY,
    template_id INTEGER NOT NULL REFERENCES message_templates(id) ON DELETE CASCADE,
    media_url TEXT NOT NULL,
    content_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_template_attachments_template_position
ON template_attachments(template_id, position);
