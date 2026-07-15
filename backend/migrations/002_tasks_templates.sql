CREATE TABLE IF NOT EXISTS lead_tasks (
    id BIGSERIAL PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES leads(remote_jid) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT,
    task_type TEXT NOT NULL DEFAULT 'seguimiento',
    status TEXT NOT NULL DEFAULT 'pending',
    priority TEXT NOT NULL DEFAULT 'normal',
    due_at TIMESTAMPTZ NOT NULL,
    remind_at TIMESTAMPTZ,
    reminder_sent_at TIMESTAMPTZ,
    assigned_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    completed_at TIMESTAMPTZ,
    completed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT lead_tasks_type_check CHECK (task_type IN ('whatsapp','llamada','cotizacion','cita','seguimiento','otro')),
    CONSTRAINT lead_tasks_status_check CHECK (status IN ('pending','completed','canceled')),
    CONSTRAINT lead_tasks_priority_check CHECK (priority IN ('low','normal','high'))
);
CREATE INDEX IF NOT EXISTS idx_lead_tasks_assignee_status_due ON lead_tasks(assigned_user_id, status, due_at);
CREATE INDEX IF NOT EXISTS idx_lead_tasks_lead_status_due ON lead_tasks(lead_id, status, due_at);

CREATE TABLE IF NOT EXISTS message_templates (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    content TEXT NOT NULL,
    shortcut TEXT UNIQUE,
    category TEXT NOT NULL DEFAULT 'general',
    stage TEXT,
    task_type TEXT,
    service TEXT,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_message_templates_active_category ON message_templates(is_active, category);
CREATE UNIQUE INDEX IF NOT EXISTS uq_message_templates_shortcut_lower ON message_templates(lower(shortcut));
