-- 026: fusión de leads duplicados por doble instancia de WhatsApp.
-- Aplicar manualmente: psql "$DATABASE_URL" -f backend/migrations/026_merge_duplicate_leads_dual_instance.sql
--
-- Causa raíz: whatsapp_identities es único por (instance, jid). Con dos
-- instancias activas (dermicapro y dermicaproventas) para el mismo negocio,
-- un contacto que ya tenía lead en una instancia generaba un lead NUEVO y
-- vacío al escribir por la otra instancia. El "+" en telefono es solo un
-- síntoma: los leads nuevos ya se crean con telefono normalizado ('+' +
-- dígitos), los viejos no. Detectado 2026-08-26.
--
-- 6 pares confirmados (mismo número real, remote_jid coincide o es el split
-- @lid/teléfono ya documentado). NO toca los leads con telefono duplicado
-- por otro motivo (51959513274, 51974637783: mismo valor de telefono pero
-- remote_jid distinto = clientes distintos, bug de dato separado, fuera de
-- alcance de este script).

BEGIN;

CREATE TEMP TABLE lead_merge_pairs (survivor uuid, loser uuid) ON COMMIT DROP;
INSERT INTO lead_merge_pairs (survivor, loser) VALUES
  ('69c0b33e-19fa-4d60-9631-338bbc2602e8', 'bd8812c4-9898-46f6-9715-c36302087fe9'), -- ferjhonny20 (51936624680)
  ('c8040108-0dca-4e13-b650-9098c354c0e1', '5f46a06c-c9cd-4472-8395-5bb22b5bb4bf'), -- Milton Napoleón Díaz Abanto (51942960032)
  ('e7562caf-ae3f-4981-8eb5-bb656afafc56', '0f7b8592-ffd2-4bc7-a13a-aef03d53cb2c'), -- Thiago (51964677858)
  ('30ee848a-b499-402b-8bd1-b37bf58814ff', '634076ce-05fa-46a7-85a5-f3fa8e872d1d'), -- MC (51982464509)
  ('15bcaec6-37bc-4e2d-9120-348e24a01817', '1b531e4b-81d2-4461-b572-5fe684d5a1fb'), -- Marleny (51993604863)
  ('103421b6-6436-4c88-be55-3ae5f73348f4', '96e3d737-5743-4df0-b5ec-95277479443b'); -- Jerlin 💕 <- Rosa (51918366726, split @lid/teléfono)

-- lead_tag_assignments: PK (lead_id, tag_id) -> evitar choque si ambos leads
-- comparten un tag, descartando la copia del lead perdedor antes de mover.
DELETE FROM lead_tag_assignments lta
USING lead_merge_pairs p
WHERE lta.lead_id = p.loser
  AND EXISTS (
    SELECT 1 FROM lead_tag_assignments s
    WHERE s.lead_id = p.survivor AND s.tag_id = lta.tag_id
  );

UPDATE lead_tag_assignments lta SET lead_id = p.survivor
FROM lead_merge_pairs p WHERE lta.lead_id = p.loser;

UPDATE lead_activity la SET lead_id = p.survivor
FROM lead_merge_pairs p WHERE la.lead_id = p.loser;

UPDATE lead_notes ln SET lead_id = p.survivor
FROM lead_merge_pairs p WHERE ln.lead_id = p.loser;

UPDATE lead_tasks lt SET lead_id = p.survivor
FROM lead_merge_pairs p WHERE lt.lead_id = p.loser;

UPDATE message_outbox mo SET chat_id = p.survivor
FROM lead_merge_pairs p WHERE mo.chat_id = p.loser;

UPDATE scheduled_messages sm SET lead_id = p.survivor
FROM lead_merge_pairs p WHERE sm.lead_id = p.loser;

UPDATE user_notifications un SET lead_id = p.survivor
FROM lead_merge_pairs p WHERE un.lead_id = p.loser;

UPDATE automation_executions ae SET lead_id = p.survivor
FROM lead_merge_pairs p WHERE ae.lead_id = p.loser;

UPDATE issue_reports ir SET lead_id = p.survivor
FROM lead_merge_pairs p WHERE ir.lead_id = p.loser;

UPDATE whatsapp_identities wi SET lead_id = p.survivor
FROM lead_merge_pairs p WHERE wi.lead_id = p.loser;

UPDATE wsp_messages wm SET chat_id = p.survivor
FROM lead_merge_pairs p WHERE wm.chat_id = p.loser;

-- Caso especial: Jerlin/Rosa son el único par donde el "perdedor" tenía
-- nombre y notas propias (no un lead vacío). Se preserva la nota de Rosa
-- como contexto histórico dentro de las notas de Jerlin, que es el perfil
-- que sobrevive (decisión del usuario: más actividad reciente).
UPDATE leads
SET notas = notas || E'\n\n[Fusionado desde lead Rosa / 51918366726 vía teléfono directo, perdido]: '
                    || (SELECT notas FROM leads WHERE id = '96e3d737-5743-4df0-b5ec-95277479443b'),
    updated_at = now()
WHERE id = '103421b6-6436-4c88-be55-3ae5f73348f4';

-- Normalizar telefono del sobreviviente a formato E.164 display, igual que 022.
UPDATE leads l SET telefono = '+' || regexp_replace(telefono, '^\+', '')
FROM lead_merge_pairs p
WHERE l.id = p.survivor;

DELETE FROM leads WHERE id IN (SELECT loser FROM lead_merge_pairs);

COMMIT;
