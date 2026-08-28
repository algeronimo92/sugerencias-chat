-- 027: reaplicación de la normalización de telefono (ver 022).
-- Aplicar manualmente: psql "$DATABASE_URL" -f backend/migrations/027_reapply_phone_normalization.sql
--
-- 022 fue un backfill de una sola vez sin tabla de control de versiones.
-- n8n sigue insertando leads con telefono sin "+" cada día, y detectamos
-- además 7 filas con telefono genuinamente distinto de su propio remote_jid
-- (numero de otra persona mencionado en el texto, o valor de relleno tipo
-- "525512345678"/"Juan Pérez"). En ambos casos remote_jid es la fuente de
-- verdad, así que se re-deriva telefono desde ahí sin excepción.
-- Detectado 2026-08-26.

BEGIN;

UPDATE leads
SET telefono = '+' || split_part(remote_jid, '@', 1)
WHERE remote_jid ~ '^[0-9]+@s\.whatsapp\.net$'
  AND telefono IS DISTINCT FROM '+' || split_part(remote_jid, '@', 1);

-- Un grupo (@g.us) no tiene número propio; no debería cargar un telefono ajeno.
UPDATE leads
SET telefono = NULL
WHERE remote_jid LIKE '%@g.us' AND telefono IS NOT NULL;

COMMIT;
