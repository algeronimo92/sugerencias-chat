-- Acota las queries de discovery de automatizaciones (antes hacían full scan
-- de wsp_messages/lead_tasks cada 10 segundos).
CREATE INDEX IF NOT EXISTS idx_wsp_messages_sent_at ON wsp_messages(sent_at);

CREATE INDEX IF NOT EXISTS idx_lead_tasks_due_pending
ON lead_tasks(due_at) WHERE status = 'pending';

-- Contador de reclamos de una ejecución: permite dejar de reintentar
-- ejecuciones interrumpidas después de MAX_EXECUTION_ATTEMPTS.
ALTER TABLE automation_executions
    ADD COLUMN IF NOT EXISTS attempts INTEGER NOT NULL DEFAULT 0;

-- Definiciones publicadas de flujos visuales, una fila por versión. Las
-- ejecuciones referencian (rule_id, flow_version) en vez de duplicar el JSON
-- completo del flujo en cada fila de automation_executions.
CREATE TABLE IF NOT EXISTS automation_flow_versions (
    id SERIAL PRIMARY KEY,
    rule_id INTEGER NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
    version INTEGER NOT NULL,
    definition JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_automation_flow_versions_rule_version
ON automation_flow_versions(rule_id, version);
