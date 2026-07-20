CREATE TABLE IF NOT EXISTS user_notifications (
    id BIGSERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    lead_id TEXT REFERENCES leads(remote_jid) ON DELETE SET NULL,
    source_id TEXT,
    metadata JSONB,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_created
ON user_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_notifications_user_read
ON user_notifications(user_id, read_at);

CREATE INDEX IF NOT EXISTS idx_user_notifications_lead
ON user_notifications(lead_id);

INSERT INTO user_notifications
    (user_id, notification_type, title, body, lead_id, source_id, metadata, read_at, created_at)
SELECT
    m.user_id,
    'internal_note_mention',
    u.name || ' te mencionó en una nota',
    n.content,
    n.lead_id,
    n.id::text,
    jsonb_build_object('note_id', n.id, 'author_user_id', u.id, 'author_name', u.name),
    m.read_at,
    m.created_at
FROM lead_note_mentions m
JOIN lead_notes n ON n.id = m.note_id
JOIN users u ON u.id = n.author_user_id
WHERE m.user_id <> n.author_user_id
  AND NOT EXISTS (
      SELECT 1 FROM user_notifications un
      WHERE un.user_id = m.user_id
        AND un.notification_type = 'internal_note_mention'
        AND un.source_id = n.id::text
  );
