#!/usr/bin/env bash
#
# Exporta, marca por marca, todo lo que cuelga de ella en la base.
#
# Contexto: la base de dermicapro_db terminó conteniendo datos de seis marcas
# distintas (ver docs del incidente 2026-08-08). Antes de borrar lo ajeno hay
# que poder devolvérselo a quien corresponda, y hay que conservarlo como
# evidencia. Este script no borra nada: solo lee.
#
# Salida: db/backups/marcas/<slug>/*.csv, un CSV por tabla con cabecera.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT="$ROOT/db/backups/marcas"
CONTAINER="dermicapro-data-postgres-1"
PGUSER="$(grep -E '^POSTGRES_USER=' "$ROOT/db/.env" | cut -d= -f2-)"
PGPASS="$(grep -E '^POSTGRES_PASSWORD=' "$ROOT/db/.env" | cut -d= -f2-)"
PGDB="$(grep -E '^POSTGRES_DB=' "$ROOT/db/.env" | cut -d= -f2-)"

q() { docker exec -e PGPASSWORD="$PGPASS" "$CONTAINER" psql -U "$PGUSER" -d "$PGDB" -tAc "$1"; }
dump_csv() { # $1 = consulta, $2 = archivo destino
  docker exec -e PGPASSWORD="$PGPASS" "$CONTAINER" \
    psql -U "$PGUSER" -d "$PGDB" -c "COPY ($1) TO STDOUT WITH CSV HEADER" > "$2"
}

# Tablas hijas de leads y por qué columna enlazan. wsp_messages y
# message_outbox usan chat_id en vez de lead_id: es la misma relación con otro
# nombre, herencia de cuando el lead se identificaba por remote_jid.
LEAD_TABLES="lead_activity:lead_id lead_notes:lead_id lead_tasks:lead_id
lead_tag_assignments:lead_id scheduled_messages:lead_id user_notifications:lead_id
whatsapp_identities:lead_id automation_executions:lead_id ai_usage_events:lead_id
integration_external_conversations:lead_id wsp_messages:chat_id message_outbox:chat_id"

# Tablas de configuración que cuelgan directo de la marca.
BRAND_TABLES="brand_ai_settings brand_knowledge_sources brand_loss_reasons
brand_memberships brand_pipeline_stages brand_sla_settings whatsapp_instances
automation_rules lead_tags media_assets message_templates
integration_import_jobs integration_source_mappings integration_import_issues
administrative_audit_log automation_approval_requests"

mkdir -p "$OUT"

while IFS='|' read -r bid slug; do
  [ -z "$bid" ] && continue
  dir="$OUT/$slug"
  mkdir -p "$dir"
  echo "== marca $bid ($slug)"

  dump_csv "SELECT * FROM brands WHERE id=$bid" "$dir/brands.csv"
  dump_csv "SELECT * FROM leads WHERE brand_id=$bid" "$dir/leads.csv"

  for spec in $LEAD_TABLES; do
    t="${spec%%:*}"; col="${spec##*:}"
    dump_csv "SELECT * FROM $t WHERE $col IN (SELECT id FROM leads WHERE brand_id=$bid)" "$dir/$t.csv"
  done

  for t in $BRAND_TABLES; do
    dump_csv "SELECT * FROM $t WHERE brand_id=$bid" "$dir/$t.csv"
  done

  # Los conteos se piden a la base, NO se cuentan líneas del CSV: el contenido
  # de los mensajes tiene saltos de línea, así que un registro ocupa varias
  # líneas y `wc -l` llegó a inflar el total al doble.
  leads_n=$(q "SELECT count(*) FROM leads WHERE brand_id=$bid")
  msgs_n=$(q "SELECT count(*) FROM wsp_messages WHERE chat_id IN (SELECT id FROM leads WHERE brand_id=$bid)")
  echo "   leads=$leads_n mensajes=$msgs_n  -> $dir"
done < <(q "SELECT id||'|'||regexp_replace(lower(coalesce(slug,name)),'[^a-z0-9]+','-','g') FROM brands ORDER BY id")

echo
echo "Exportación completa en $OUT"
du -sh "$OUT"
