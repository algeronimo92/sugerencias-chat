-- Tope de seguridad por regla: máximo de ejecuciones completadas por hora
-- antes de re-agendar el resto en vez de correrlas. NULL = sin límite.
ALTER TABLE automation_rules
    ADD COLUMN IF NOT EXISTS max_executions_per_hour INTEGER;
