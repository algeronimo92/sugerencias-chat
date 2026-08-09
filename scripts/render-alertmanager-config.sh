#!/usr/bin/env bash
#
# Genera monitoring/alertmanager/alertmanager.yml a partir de la plantilla
# versionada (monitoring/alertmanager.yml.template), embebiendo la URL real
# del webhook de n8n. Ver esa plantilla para el porqué (Alertmanager 0.27.0
# hace panic con `url_file`, así que el secreto se hornea acá en vez de
# referenciarse en caliente).
#
# Correr después de cambiar monitoring/secrets/n8n_webhook_url, y recrear
# alertmanager para que lo recargue:
#
#   scripts/render-alertmanager-config.sh
#   docker compose -f compose.monitoring.yml --env-file monitoring/.env up -d alertmanager

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TEMPLATE="$ROOT/monitoring/alertmanager.yml.template"
SECRET="$ROOT/monitoring/secrets/n8n_webhook_url"
OUT="$ROOT/monitoring/alertmanager/alertmanager.yml"

: "${SECRET:?}"
[ -s "$SECRET" ] || { echo "ERROR: $SECRET no existe o está vacío." >&2; exit 1; }

WEBHOOK_URL="$(tr -d '[:space:]' < "$SECRET")"

sed "s|__N8N_WEBHOOK_URL__|$WEBHOOK_URL|" "$TEMPLATE" > "$OUT"
echo "Generado: $OUT"
