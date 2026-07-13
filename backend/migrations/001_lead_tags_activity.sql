CREATE TABLE IF NOT EXISTS lead_tags (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    color TEXT NOT NULL DEFAULT '#16a34a',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_lead_tags_name_lower ON lead_tags (lower(name));
CREATE INDEX IF NOT EXISTS idx_lead_tags_created_by ON lead_tags (created_by);

CREATE TABLE IF NOT EXISTS lead_tag_assignments (
    lead_id TEXT NOT NULL REFERENCES leads(remote_jid) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES lead_tags(id) ON DELETE CASCADE,
    assigned_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (lead_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_lead_tag_assignments_tag_lead
    ON lead_tag_assignments (tag_id, lead_id);
CREATE INDEX IF NOT EXISTS idx_lead_tag_assignments_assigned_by
    ON lead_tag_assignments (assigned_by);

CREATE TABLE IF NOT EXISTS lead_activity (
    id BIGSERIAL PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(remote_jid) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    actor_type TEXT NOT NULL,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    old_value JSONB,
    new_value JSONB,
    metadata JSONB,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_lead_activity_lead_created
    ON lead_activity (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lead_activity_actor_user
    ON lead_activity (actor_user_id);

-- Estas tablas se consumen exclusivamente a través del backend autenticado.
-- Sin políticas públicas, la Data API no expone sus filas a anon/authenticated.
ALTER TABLE lead_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_tag_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE lead_activity ENABLE ROW LEVEL SECURITY;
