ALTER TABLE message_templates
ADD COLUMN IF NOT EXISTS official_header_media_asset_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'fk_message_templates_official_header_media_asset_id'
    ) THEN
        ALTER TABLE message_templates
        ADD CONSTRAINT fk_message_templates_official_header_media_asset_id
        FOREIGN KEY (official_header_media_asset_id) REFERENCES media_assets(id) ON DELETE SET NULL;
    END IF;
END $$;
