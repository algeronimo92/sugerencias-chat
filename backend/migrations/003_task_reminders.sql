ALTER TABLE lead_tasks
ADD COLUMN IF NOT EXISTS reminder_sent_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_lead_tasks_pending_reminder
ON lead_tasks(remind_at)
WHERE status = 'pending' AND reminder_sent_at IS NULL;
