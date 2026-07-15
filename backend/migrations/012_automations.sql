CREATE TABLE IF NOT EXISTS automation_rules (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    trigger_type TEXT NOT NULL,
    trigger_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    conditions JSONB NOT NULL DEFAULT '{}'::jsonb,
    actions JSONB NOT NULL DEFAULT '[]'::jsonb,
    delay_minutes INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_automation_rules_trigger_active
ON automation_rules(trigger_type, is_active);

CREATE TABLE IF NOT EXISTS automation_executions (
    id BIGSERIAL PRIMARY KEY,
    rule_id INTEGER NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    lead_id TEXT REFERENCES leads(remote_jid) ON DELETE SET NULL,
    trigger_type TEXT NOT NULL,
    event_key TEXT NOT NULL,
    event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL DEFAULT 'scheduled',
    scheduled_for TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    action_results JSONB NOT NULL DEFAULT '[]'::jsonb,
    error TEXT,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_execution_rule_event
ON automation_executions(rule_id, event_key);

CREATE INDEX IF NOT EXISTS idx_automation_executions_due
ON automation_executions(status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_automation_executions_rule_created
ON automation_executions(rule_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_automation_executions_lead_created
ON automation_executions(lead_id, created_at DESC);
