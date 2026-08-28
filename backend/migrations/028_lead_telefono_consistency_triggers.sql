-- 028: telefono deja de ser un campo libre — se deriva siempre de remote_jid
-- (o de whatsapp_identities cuando remote_jid es un @lid sin resolver).
-- Aplicar manualmente: psql "$DATABASE_URL" -f backend/migrations/028_lead_telefono_consistency_triggers.sql
--
-- Causa raíz (ver 022, 026, 027): telefono se desincroniza porque hay varios
-- escritores (backend, n8n, scripts manuales) y cada uno decide el formato
-- por su cuenta. La normalización hasta ahora era un backfill puntual que
-- había que volver a correr a mano cada vez que se detectaba basura nueva.
-- Esto reemplaza esos backfills por dos triggers que recalculan telefono en
-- cada escritura, para que ningún proceso pueda desviarlo:
--
--   1. leads: en cada insert/update, telefono se deriva de remote_jid.
--      - @s.whatsapp.net -> '+' + dígitos (gana siempre, es la fuente de
--        verdad para chats ya resueltos por teléfono).
--      - @g.us (grupo)   -> NULL (un grupo no tiene número propio).
--      - @lid            -> busca un alias 'phone' ya conocido en
--        whatsapp_identities para ese lead; si no hay ninguno, NO toca
--        telefono (no hay nada mejor que escribir todavía — ver Juan Pérez /
--        William Alayo, que quedaron así semanas hasta que Evolution
--        resolvió el alias).
--   2. whatsapp_identities: cuando aparece o cambia un alias 'phone' (lo
--      escribe learn_send_aliases, o el propio merge_leads al mover alias de
--      un lead a otro), actualiza el telefono del lead dueño. Esto es lo que
--      hubiera evitado el arreglo manual de Moni/Ysabel/Maria Grecia.
--
-- Detectado / diseñado 2026-08-28.

BEGIN;

CREATE OR REPLACE FUNCTION lead_phone_from_jid(jid text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN jid ~ '^[0-9]+@s\.whatsapp\.net$' THEN '+' || split_part(jid, '@', 1)
        ELSE NULL
    END;
$$;

CREATE OR REPLACE FUNCTION leads_derive_telefono_from_remote_jid()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_derived text;
BEGIN
    IF NEW.remote_jid IS NULL THEN
        RETURN NEW;
    END IF;

    IF NEW.remote_jid LIKE '%@g.us' THEN
        NEW.telefono := NULL;
        RETURN NEW;
    END IF;

    v_derived := lead_phone_from_jid(NEW.remote_jid);
    IF v_derived IS NOT NULL THEN
        NEW.telefono := v_derived;
        RETURN NEW;
    END IF;

    IF NEW.remote_jid LIKE '%@lid' AND NEW.id IS NOT NULL THEN
        SELECT lead_phone_from_jid(wi.jid) INTO v_derived
        FROM whatsapp_identities wi
        WHERE wi.lead_id = NEW.id AND wi.kind = 'phone'
        ORDER BY wi.updated_at DESC
        LIMIT 1;
        IF v_derived IS NOT NULL THEN
            NEW.telefono := v_derived;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_leads_derive_telefono ON leads;
CREATE TRIGGER trg_leads_derive_telefono
    BEFORE INSERT OR UPDATE ON leads
    FOR EACH ROW
    EXECUTE FUNCTION leads_derive_telefono_from_remote_jid();

CREATE OR REPLACE FUNCTION whatsapp_identities_sync_lead_telefono()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
    v_derived text;
BEGIN
    IF NEW.kind <> 'phone' THEN
        RETURN NEW;
    END IF;
    v_derived := lead_phone_from_jid(NEW.jid);
    IF v_derived IS NULL THEN
        RETURN NEW;
    END IF;
    UPDATE leads
    SET telefono = v_derived, updated_at = now()
    WHERE id = NEW.lead_id AND telefono IS DISTINCT FROM v_derived;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_identities_sync_telefono ON whatsapp_identities;
CREATE TRIGGER trg_whatsapp_identities_sync_telefono
    AFTER INSERT OR UPDATE OF jid, lead_id ON whatsapp_identities
    FOR EACH ROW
    WHEN (NEW.kind = 'phone')
    EXECUTE FUNCTION whatsapp_identities_sync_lead_telefono();

-- Reaplicar sobre los datos existentes: dispara el trigger de leads en cada
-- fila tocando una columna sin efecto (remote_jid = remote_jid) para que
-- quede exactamente igual a lo que ya dejaron 022/026/027, pero ahora por el
-- mismo camino que va a usar el trigger de acá en adelante.
UPDATE leads SET remote_jid = remote_jid;

COMMIT;
