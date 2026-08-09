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

[ -s "$SECRET" ] || { echo "ERROR: $SECRET no existe o está vacío." >&2; exit 1; }

# El directorio está en git (con .gitkeep) pero su contenido no, así que en un
# clon nuevo existe vacío. Igual se crea acá por las dudas: si no existiera, el
# `>` de abajo moriría con "No such file or directory" y, peor, un `docker
# compose up` previo lo habría creado como directorio vacío y alertmanager
# quedaría en crash-loop sin config.
mkdir -p "$(dirname "$OUT")"

WEBHOOK_URL="$(tr -d '[:space:]' < "$SECRET")"

# index/substr y no `sed s|…|…|` (ni gsub, ni la expansión ${var//…/…} de bash):
# en el texto de reemplazo de los tres, `&` significa "todo lo que matcheó", así
# que una URL de webhook con query string (…?a=1&b=2) se corrompía en silencio y
# alertmanager quedaba notificando a una URL rota. index/substr no interpretan
# nada: la URL entra literal.
awk -v url="$WEBHOOK_URL" '
  { i = index($0, "__N8N_WEBHOOK_URL__")
    if (i) $0 = substr($0, 1, i - 1) url substr($0, i + length("__N8N_WEBHOOK_URL__"))
    print }
' "$TEMPLATE" > "$OUT"
echo "Generado: $OUT"
