#!/usr/bin/env bash
#
# Copia la base actual (la de db/.env) a la que pide backend/.env.
#
# Para cuando el backend pasa a otra base y otro usuario dentro del mismo
# PostgreSQL. El origen no se toca: queda como vuelta atrás. El destino se crea
# con su propio rol, sin superusuario, dueño de todo lo restaurado.
#
# Por qué cada cosa:
#   - El rol toma la contraseña del DATABASE_URL de backend/.env y se le pasa a
#     psql por stdin, nunca por argumentos (quedaría en `ps`). La sesión apaga
#     el log de sentencias para que tampoco quede en el log de PostgreSQL.
#   - Las extensiones las crea el superusuario antes de restaurar: el rol de la
#     aplicación no puede, y el dump intentaría recrearlas.
#   - --no-owner --role deja todo a nombre del rol nuevo; --no-acl no arrastra
#     los permisos de otros roles (n8n_app) a una base que no los necesita.
#   - --single-transaction --exit-on-error: o queda entera o no queda nada.
#   - Al final compara el conteo de filas de cada tabla en las dos bases.
#
# Uso:
#   scripts/db-clone.sh               copia; aborta si la app sigue conectada al
#                                     origen o si el destino ya existe
#   scripts/db-clone.sh --allow-live  ensayo con la app en marcha (la copia no
#                                     es consistente con lo que siga escribiendo)
#   scripts/db-clone.sh --replace     borra el destino antes de copiar
#   scripts/db-clone.sh --verify      solo compara conteos origen/destino
#
# REPO_ROOT apunta al checkout que tiene los .env y el compose de la base, por
# si el script se corre desde otro (un worktree con una rama sin desplegar).

set -euo pipefail

ROOT="${REPO_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
COMPOSE="docker compose -f $ROOT/compose.db.yml --env-file $ROOT/db/.env"
BACKUP_DIR="$ROOT/db/backups"

env_value() {
  grep -E "^$2=" "$1" | head -1 | cut -d= -f2- | sed -E 's/^"(.*)"$/\1/; s/^'"'"'(.*)'"'"'$/\1/'
}

urldecode() {
  local value="${1//+/ }"
  printf '%b' "${value//%/\\x}"
}

SOURCE_USER="$(env_value "$ROOT/db/.env" POSTGRES_USER)"
SOURCE_DB="$(env_value "$ROOT/db/.env" POSTGRES_DB)"

DATABASE_URL="$(env_value "$ROOT/backend/.env" DATABASE_URL)"
# postgresql+asyncpg://usuario:contraseña@host:puerto/base?parametros
if [[ ! "$DATABASE_URL" =~ ^[a-z+]+://([^:@/]+):([^@]*)@[^/]+/([^?]+) ]]; then
  echo "ERROR: no se pudo leer usuario, contraseña y base del DATABASE_URL de backend/.env" >&2
  exit 1
fi
TARGET_USER="$(urldecode "${BASH_REMATCH[1]}")"
TARGET_PASSWORD="$(urldecode "${BASH_REMATCH[2]}")"
TARGET_DB="$(urldecode "${BASH_REMATCH[3]}")"

if [ "$TARGET_DB" = "$SOURCE_DB" ]; then
  echo "ERROR: backend/.env apunta a la misma base que db/.env ($SOURCE_DB); no hay nada que copiar." >&2
  exit 1
fi
for name in "$TARGET_USER" "$TARGET_DB"; do
  # Van entre comillas dobles en el SQL: se exige un identificador simple para
  # no tener que escaparlos.
  [[ "$name" =~ ^[a-z_][a-z0-9_]*$ ]] || { echo "ERROR: nombre no admitido: $name" >&2; exit 1; }
done

pg() {
  # Igual que db-backup.sh: la contraseña del superusuario la pone el propio
  # contenedor, no la línea de comandos del host.
  $COMPOSE exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec "$@"' sh "$@"
}

psql_on() {
  local db="$1"; shift
  pg psql -X -q -v ON_ERROR_STOP=1 -U "$SOURCE_USER" -d "$db" "$@"
}

sql_literal() {
  printf "'%s'" "${1//\'/\'\'}"
}

row_counts() {
  # Una línea "schema.tabla<TAB>filas" por tabla de usuario, ordenada.
  psql_on "$1" -At -F $'\t' <<'SQL' | sort
SELECT format('SELECT %L, count(*) FROM %I.%I', schemaname || '.' || tablename, schemaname, tablename)
FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog', 'information_schema')
\gexec
SQL
}

cmd_verify() {
  local tmp; tmp="$(mktemp -d)"
  row_counts "$SOURCE_DB" > "$tmp/source"
  row_counts "$TARGET_DB" > "$tmp/target"
  if diff -u "$tmp/source" "$tmp/target" > "$tmp/diff"; then
    echo "Verificado: $(wc -l < "$tmp/source") tablas con el mismo número de filas en $SOURCE_DB y $TARGET_DB."
    rm -rf "$tmp"
    return 0
  fi
  echo "ERROR: los conteos no coinciden (- $SOURCE_DB, + $TARGET_DB):" >&2
  grep -E '^[-+][^-+]' "$tmp/diff" >&2 || true
  rm -rf "$tmp"
  return 1
}

cmd_clone() {
  local allow_live="$1" replace="$2"

  local activas
  activas="$(psql_on "$SOURCE_DB" -At <<SQL
SELECT usename || ' desde ' || coalesce(host(client_addr), 'socket') || ' (' || count(*) || ')'
FROM pg_stat_activity
WHERE datname = $(sql_literal "$SOURCE_DB")
  AND pid <> pg_backend_pid()
  AND usename <> 'postgres_exporter'
GROUP BY usename, client_addr;
SQL
)"
  if [ -n "$activas" ] && [ "$allow_live" != 1 ]; then
    echo "ERROR: hay conexiones abiertas a $SOURCE_DB; parar backend y worker antes de copiar:" >&2
    echo "$activas" | sed 's/^/  /' >&2
    echo "Para un ensayo con la app en marcha: --allow-live" >&2
    exit 1
  fi

  local existe
  existe="$(psql_on postgres -At -c "SELECT 1 FROM pg_database WHERE datname = $(sql_literal "$TARGET_DB")")"
  if [ -n "$existe" ]; then
    if [ "$replace" != 1 ]; then
      echo "ERROR: la base $TARGET_DB ya existe. Para borrarla y copiar de nuevo: --replace" >&2
      exit 1
    fi
    echo "Borrando $TARGET_DB (el origen $SOURCE_DB no se toca)..."
    psql_on postgres -c "DROP DATABASE \"$TARGET_DB\" WITH (FORCE)"
  fi

  # Si el rol ya existe se le actualiza la contraseña: lo que manda es el .env.
  local verbo=CREATE
  if [ -n "$(psql_on postgres -At -c "SELECT 1 FROM pg_roles WHERE rolname = $(sql_literal "$TARGET_USER")")" ]; then
    verbo=ALTER
  fi
  echo "Rol $TARGET_USER ($verbo) con la contraseña de backend/.env..."
  psql_on postgres <<SQL
SET log_statement = 'none';
SET log_min_duration_statement = -1;
$verbo ROLE "$TARGET_USER" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD $(sql_literal "$TARGET_PASSWORD");
SQL

  echo "Creando $TARGET_DB..."
  psql_on postgres -c "CREATE DATABASE \"$TARGET_DB\" OWNER \"$TARGET_USER\" TEMPLATE template0 ENCODING 'UTF8'"
  psql_on "$TARGET_DB" <<SQL
CREATE EXTENSION IF NOT EXISTS unaccent;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER SCHEMA public OWNER TO "$TARGET_USER";
SQL

  mkdir -p "$BACKUP_DIR"
  local stamp dump list container
  stamp="$(date +%Y%m%d-%H%M%S)"
  dump="$BACKUP_DIR/clone-$SOURCE_DB-$stamp.dump"
  list="$BACKUP_DIR/clone-$SOURCE_DB-$stamp.list"
  echo "Volcando $SOURCE_DB..."
  ( umask 077; pg pg_dump -U "$SOURCE_USER" -d "$SOURCE_DB" -Fc > "$dump" ) || {
    rm -f "$dump"; echo "ERROR: pg_dump falló." >&2; exit 1;
  }
  echo "  -> ${dump#"$ROOT"/} ($(du -h "$dump" | cut -f1)); queda además como backup"

  # Fuera del índice: las extensiones (ya creadas arriba, y su COMMENT exige
  # ser dueño) y el schema public (ya existe en la base nueva).
  $COMPOSE exec -T postgres pg_restore --list < "$dump" \
    | grep -vE ' EXTENSION | COMMENT - EXTENSION | SCHEMA - public ' > "$list"

  container="$($COMPOSE ps -q postgres)"
  docker cp "$dump" "$container:/tmp/clone.dump" >/dev/null
  docker cp "$list" "$container:/tmp/clone.list" >/dev/null
  echo "Restaurando en $TARGET_DB como $TARGET_USER..."
  if ! pg pg_restore -U "$SOURCE_USER" -d "$TARGET_DB" \
      --no-owner --no-acl --role="$TARGET_USER" \
      --single-transaction --exit-on-error \
      -L /tmp/clone.list /tmp/clone.dump; then
    docker exec "$container" rm -f /tmp/clone.dump /tmp/clone.list
    echo "ERROR: la restauración falló y se deshizo entera. $TARGET_DB quedó vacía." >&2
    exit 1
  fi
  docker exec "$container" rm -f /tmp/clone.dump /tmp/clone.list
  rm -f "$list"

  psql_on "$TARGET_DB" -c "ANALYZE"
  cmd_verify
}

allow_live=0
replace=0
case "${1:-}" in
  --verify)     cmd_verify; exit $? ;;
  --allow-live) allow_live=1 ;;
  --replace)    replace=1 ;;
  "")           ;;
  *)            echo "Uso: $0 [--allow-live] [--replace] | --verify" >&2; exit 2 ;;
esac
case "${2:-}" in
  --allow-live) allow_live=1 ;;
  --replace)    replace=1 ;;
  "")           ;;
  *)            echo "Uso: $0 [--allow-live] [--replace] | --verify" >&2; exit 2 ;;
esac

cmd_clone "$allow_live" "$replace"
