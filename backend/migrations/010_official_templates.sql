ALTER TABLE message_templates
ADD COLUMN IF NOT EXISTS template_type TEXT NOT NULL DEFAULT 'internal',
ADD COLUMN IF NOT EXISTS official_name TEXT,
ADD COLUMN IF NOT EXISTS official_language TEXT,
ADD COLUMN IF NOT EXISTS official_category TEXT,
ADD COLUMN IF NOT EXISTS official_status TEXT,
ADD COLUMN IF NOT EXISTS official_parameter_values JSONB NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_message_templates_type_status
ON message_templates(template_type, official_status, is_active);
