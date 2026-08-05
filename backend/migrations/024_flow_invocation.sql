-- Distingue las ejecuciones creadas por un bloque "Invocar flujo" de los
-- disparadores del sistema y de los inicios manuales del vendedor.
ALTER TABLE automation_executions
    DROP CONSTRAINT IF EXISTS ck_automation_executions_start_source;

ALTER TABLE automation_executions
    ADD CONSTRAINT ck_automation_executions_start_source
    CHECK (start_source IN ('system', 'manual', 'flow'));
