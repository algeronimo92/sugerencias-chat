CREATE TABLE IF NOT EXISTS media_assets (
    id SERIAL PRIMARY KEY,
    media_url TEXT NOT NULL UNIQUE,
    content_type TEXT NOT NULL,
    filename TEXT NOT NULL,
    size_bytes BIGINT NOT NULL DEFAULT 0,
    uploaded_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_assets_created_at
ON media_assets(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_media_assets_content_type
ON media_assets(content_type);

ALTER TABLE template_attachments
ADD COLUMN IF NOT EXISTS library_asset_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'template_attachments_library_asset_id_fkey'
    ) THEN
        ALTER TABLE template_attachments
        ADD CONSTRAINT template_attachments_library_asset_id_fkey
        FOREIGN KEY (library_asset_id) REFERENCES media_assets(id) ON DELETE RESTRICT;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_template_attachments_library_asset
ON template_attachments(library_asset_id);

INSERT INTO media_assets
    (media_url, content_type, filename, size_bytes, uploaded_by_user_id, created_at)
SELECT media_url, min(content_type), min(filename), 0, NULL, min(created_at)
FROM template_attachments
GROUP BY media_url
ON CONFLICT (media_url) DO NOTHING;

UPDATE template_attachments ta
SET library_asset_id = ma.id
FROM media_assets ma
WHERE ta.library_asset_id IS NULL
  AND ma.media_url = ta.media_url;
