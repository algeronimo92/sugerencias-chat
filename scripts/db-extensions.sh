#!/usr/bin/env bash
#
# Crea en la base de la aplicación las extensiones de PostgreSQL que necesita
# y que el usuario de la aplicación no puede crear solo.
#
# pgvector (búsqueda por significado del conocimiento) no es una extensión
# "trusted": crearla pide superusuario, y la aplicación puede conectarse con un
# usuario que no lo es. Este script la crea con el usuario administrador del
# contenedor (POSTGRES_USER de db/.env), en `public`, una sola vez para todos
# los schemas: la tabla de cada negocio usa el tipo porque su search_path es
# "<tenant>", public.
#
# Idempotente. El deploy (deploy.yml) lo corre después de levantar la base y
# antes de migrar; la migración que agrega los embeddings falla explicando qué
# falta si la extensión no está.
#
# Uso:
#   scripts/db-extensions.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="docker compose -f $ROOT/compose.db.yml --env-file $ROOT/db/.env"

db_env() {
  grep -E "^$1=" "$ROOT/db/.env" | head -1 | cut -d= -f2-
}

POSTGRES_USER="$(db_env POSTGRES_USER)"

# La base es la de la aplicación (DATABASE_URL de backend/.env), como en
# scripts/db-backup.sh; sin backend/.env, la base con la que se inicializó.
APP_DB=""
url="$(grep -E '^DATABASE_URL=' "$ROOT/backend/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r"'"'"'')"
if [[ "$url" =~ ^[a-z+]+://[^@]+@[^/]+/([^?]+) ]]; then
  APP_DB="${BASH_REMATCH[1]}"
else
  APP_DB="$(db_env POSTGRES_DB)"
fi
[[ "$APP_DB" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "ERROR: nombre de base no admitido: $APP_DB" >&2; exit 1; }

# pg_hba.conf exige scram también por el socket local: la contraseña sale de la
# variable que el contenedor ya tiene, no de la línea de comandos del host.
$COMPOSE exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec "$@"' sh \
  psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$APP_DB" -q \
  -c "CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public"

echo "Extensiones listas en $APP_DB: $($COMPOSE exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec "$@"' sh \
  psql -U "$POSTGRES_USER" -d "$APP_DB" -Atc "SELECT string_agg(extname || ' ' || extversion, ', ') FROM pg_extension WHERE extname = 'vector'")"
