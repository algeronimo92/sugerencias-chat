ALTER TABLE message_templates
ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'global';

ALTER TABLE message_templates
DROP CONSTRAINT IF EXISTS message_templates_shortcut_key;
DROP INDEX IF EXISTS uq_message_templates_shortcut_lower;

CREATE UNIQUE INDEX IF NOT EXISTS uq_templates_global_shortcut_lower
ON message_templates(lower(shortcut))
WHERE visibility = 'global' AND shortcut IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_templates_personal_shortcut_owner
ON message_templates(created_by_user_id, lower(shortcut))
WHERE visibility = 'personal' AND shortcut IS NOT NULL;

CREATE TABLE IF NOT EXISTS template_user_state (
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id INTEGER NOT NULL REFERENCES message_templates(id) ON DELETE CASCADE,
    is_favorite BOOLEAN NOT NULL DEFAULT FALSE,
    last_used_at TIMESTAMPTZ,
    use_count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, template_id)
);

CREATE INDEX IF NOT EXISTS idx_template_user_state_recent
ON template_user_state(user_id, last_used_at DESC);
