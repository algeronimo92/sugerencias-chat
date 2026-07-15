ALTER TABLE automation_rules
    ADD COLUMN IF NOT EXISTS builder_mode TEXT NOT NULL DEFAULT 'simple',
    ADD COLUMN IF NOT EXISTS flow_definition JSONB NOT NULL DEFAULT '{}'::jsonb,
    ADD COLUMN IF NOT EXISTS published_flow_definition JSONB,
    ADD COLUMN IF NOT EXISTS flow_version INTEGER NOT NULL DEFAULT 0;

ALTER TABLE automation_executions
    ADD COLUMN IF NOT EXISTS flow_state JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_automation_rules_builder_mode
    ON automation_rules(builder_mode, is_active);
