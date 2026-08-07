#!/usr/bin/env bash
#
# Crea el rol de PostgreSQL que usa postgres_exporter (Prometheus).
#
# Rol de solo lectura vía `pg_monitor` (sin superuser): puede leer
# pg_stat_activity, pg_stat_replication, etc., pero no tocar datos ni
# esquema. Si esa credencial se filtra, el alcance es "leer métricas", no
# "leer conversaciones de pacientes".
#
# ES IDEMPOTENTE, mismo espíritu que scripts/minio-setup.sh: volver a
# ejecutarlo no cambia la contraseña de un rol que ya existe, así que
# reejecutarlo para revisar el grant no deja al exporter con una credencial
# vencida. Para rotarla a propósito:
#
#   scripts/monitoring-setup.sh --rotate-secret
#
# Requiere que compose.db.yml ya esté levantado (lee sus credenciales de
# db/.env, que es superusuario de esa base — ver compose.db.yml).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_ENV="$ROOT/db/.env"

ROTATE_SECRET=false
for arg in "$@"; do
  case "$arg" in
    --rotate-secret) ROTATE_SECRET=true ;;
    -h|--help)
      sed -n '2,20p' "${BASH_SOURCE[0]}" | sed 's/^#\s\?//'
      exit 0
      ;;
    *) echo "opcion desconocida: $arg" >&2; exit 2 ;;
  esac
done

read_env() {
  grep -E "^$1=" "$DB_ENV" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true
}

ADMIN_USER="$(read_env POSTGRES_USER)"
ADMIN_PASSWORD="$(read_env POSTGRES_PASSWORD)"
DB_NAME="$(read_env POSTGRES_DB)"
EXPORTER_USER="postgres_exporter"

: "${ADMIN_USER:?no se encontro POSTGRES_USER en db/.env}"
: "${ADMIN_PASSWORD:?no se encontro POSTGRES_PASSWORD en db/.env}"
: "${DB_NAME:?no se encontro POSTGRES_DB en db/.env}"

CONTAINER="$(docker compose -f "$ROOT/compose.db.yml" --env-file "$DB_ENV" ps -q postgres)"
: "${CONTAINER:?la base no esta levantada (docker compose -f compose.db.yml --env-file db/.env up -d)}"

psql_admin() {
  docker exec -e PGPASSWORD="$ADMIN_PASSWORD" "$CONTAINER" \
    psql -U "$ADMIN_USER" -d "$DB_NAME" -tAc "$1"
}

ROLE_EXISTS=false
[ "$(psql_admin "SELECT 1 FROM pg_roles WHERE rolname = '$EXPORTER_USER'")" = "1" ] && ROLE_EXISTS=true

if [ "$ROLE_EXISTS" = false ] || [ "$ROTATE_SECRET" = true ]; then
  EXPORTER_PASSWORD="$(head -c 30 /dev/urandom | base64 | tr -d '/+=' | head -c 40)"
else
  EXPORTER_PASSWORD=""
fi

if [ "$ROLE_EXISTS" = true ] && [ -z "$EXPORTER_PASSWORD" ]; then
  echo "Rol      : $EXPORTER_USER ya existe, contraseña sin cambios"
  psql_admin "GRANT pg_monitor TO $EXPORTER_USER;" >/dev/null
  echo "Grant    : pg_monitor (sin cambios, GRANT es idempotente)"
  echo
  echo "Nada que actualizar en monitoring/.env: la credencial no cambió."
  echo "Para rotarla: scripts/monitoring-setup.sh --rotate-secret"
  exit 0
fi

if [ "$ROLE_EXISTS" = true ]; then
  echo "Rol      : $EXPORTER_USER ya existe, SE VA A ROTAR la contraseña"
  psql_admin "ALTER ROLE $EXPORTER_USER WITH PASSWORD '$EXPORTER_PASSWORD';" >/dev/null
else
  echo "Rol      : $EXPORTER_USER no existe, se crea"
  psql_admin "CREATE ROLE $EXPORTER_USER WITH LOGIN PASSWORD '$EXPORTER_PASSWORD';" >/dev/null
fi
psql_admin "GRANT pg_monitor TO $EXPORTER_USER;" >/dev/null
echo "Grant    : pg_monitor"

echo
echo "Comprobando que la credencial nueva autentica..."
docker exec -e PGPASSWORD="$EXPORTER_PASSWORD" "$CONTAINER" \
  psql -U "$EXPORTER_USER" -d "$DB_NAME" -tAc "SELECT 'auth ok'" || {
  echo "ERROR: el rol nuevo no pudo autenticar." >&2
  exit 1
}

echo
echo "Poner en monitoring/.env (pg_hba.conf exige TLS a toda conexión de red,"
echo "de ahí el sslmode=require):"
echo
echo "  POSTGRES_EXPORTER_DSN=postgresql://$EXPORTER_USER:$EXPORTER_PASSWORD@127.0.0.1:5432/$DB_NAME?sslmode=require"
