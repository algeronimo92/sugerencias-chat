ALTER TABLE message_templates
ADD COLUMN IF NOT EXISTS meta_template_id TEXT,
ADD COLUMN IF NOT EXISTS official_header_type TEXT NOT NULL DEFAULT 'none',
ADD COLUMN IF NOT EXISTS official_header_text TEXT,
ADD COLUMN IF NOT EXISTS official_footer TEXT,
ADD COLUMN IF NOT EXISTS official_buttons JSONB NOT NULL DEFAULT '[]'::jsonb;
