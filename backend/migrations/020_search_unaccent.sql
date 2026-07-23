-- Búsqueda de chats estilo WhatsApp: matching insensible a acentos y
-- búsqueda sobre el historial completo de mensajes (no solo el último).
--
-- El backend aplica esto de forma idempotente al arrancar (local y prod).
-- Este archivo es el respaldo manual para cuando el usuario de la base no
-- tiene permisos de CREATE EXTENSION: aplicarlo una vez con un superusuario.
--
-- unaccent no es IMMUTABLE porque su diccionario es configurable; el wrapper
-- fija el diccionario por defecto para poder usarla en índices funcionales.

CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE OR REPLACE FUNCTION f_unaccent(text) RETURNS text AS
$$ SELECT public.unaccent('public.unaccent', $1) $$
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT;

-- Índices trigram: sin ellos, el ILIKE '%..%' sobre el historial de mensajes
-- escanea toda la tabla en cada búsqueda.
CREATE INDEX IF NOT EXISTS idx_wsp_messages_content_trgm
    ON wsp_messages USING gin (f_unaccent(content) gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_leads_nombre_trgm
    ON leads USING gin (f_unaccent(nombre) gin_trgm_ops);
