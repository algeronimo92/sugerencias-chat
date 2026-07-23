-- 022: normalización display de teléfonos + clave default_country_code.
-- Aplicar manualmente: psql "$DATABASE_URL" -f backend/migrations/022_phone_normalization.sql
-- NO toca remote_jid ni mergea leads duplicados (fuera de alcance).

-- Código de país por defecto para el alta de leads. El valor efectivo cae al
-- .env / default "51" si la fila no existe; el seed lo hace explícito.
INSERT INTO app_settings (key, value) VALUES ('default_country_code', '51')
ON CONFLICT (key) DO NOTHING;

-- telefono como display E.164 (+51…), derivado del remote_jid — la fuente de
-- verdad del número real de WhatsApp. Derivar del jid (y no de regexp_replace
-- sobre telefono) evita fabricar un "+906471403" sin código de país para
-- filas viejas cargadas en formato local, y además completa los leads
-- creados por n8n que quedaron con telefono NULL.
UPDATE leads
SET telefono = '+' || split_part(remote_jid, '@', 1)
WHERE remote_jid ~ '^[0-9]+@s\.whatsapp\.net$'
  AND telefono IS DISTINCT FROM '+' || split_part(remote_jid, '@', 1);
