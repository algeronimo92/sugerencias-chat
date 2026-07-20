ALTER TABLE message_templates
ADD COLUMN IF NOT EXISTS interactive_type TEXT NOT NULL DEFAULT 'none',
ADD COLUMN IF NOT EXISTS interactive_config JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_message_templates_interactive_type
ON message_templates(interactive_type, is_active);
