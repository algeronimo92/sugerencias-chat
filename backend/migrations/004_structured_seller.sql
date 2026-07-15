ALTER TABLE leads ADD COLUMN IF NOT EXISTS vendedor_id INTEGER;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname IN ('fk_leads_vendedor_id_users', 'leads_vendedor_id_fkey')
    ) THEN
        ALTER TABLE leads
        ADD CONSTRAINT fk_leads_vendedor_id_users
        FOREIGN KEY (vendedor_id) REFERENCES users(id) ON DELETE SET NULL;
    END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_leads_vendedor_id ON leads(vendedor_id);

UPDATE leads l
SET vendedor_id = matched.id
FROM (
    SELECT lower(trim(name)) AS normalized_name, min(id) AS id
    FROM users
    WHERE is_active = true
    GROUP BY lower(trim(name))
    HAVING count(*) = 1
) matched
WHERE l.vendedor_id IS NULL
  AND l.vendedor IS NOT NULL
  AND lower(trim(l.vendedor)) = matched.normalized_name;
