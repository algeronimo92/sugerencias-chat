#!/usr/bin/env bash
#
# Copia de seguridad de PostgreSQL.
#
# Se escribe en db/backups/, que esta montado en el contenedor, de modo que el
# archivo queda en el host y no dentro del volumen: un backup que vive en el
# mismo sitio que los datos no protege de perder ese sitio.
#
# `pg_dump -Fc` genera formato custom, comprimido y restaurable por tablas con
# pg_restore. Un .sql plano solo se puede restaurar entero.
#
# Uso:
#   scripts/db-backup.sh                 crea un backup y poda los antiguos
#   scripts/db-backup.sh --verify        ademas comprueba que se puede leer
#   scripts/db-backup.sh --restore FILE  restaura (pide confirmacion)
#
# Programarlo a diario:
#   0 3 * * * cd /root/sugerencias-chat && scripts/db-backup.sh >> db/backups/cron.log 2>&1

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE="docker compose -f $ROOT/compose.db.yml --env-file $ROOT/db/.env"
BACKUP_DIR="$ROOT/db/backups"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

db_env() {
  # Se leen del mismo .env que usa el compose, para no duplicar credenciales.
  grep -E "^$1=" "$ROOT/db/.env" | head -1 | cut -d= -f2-
}

POSTGRES_USER="$(db_env POSTGRES_USER)"

# La base a respaldar es la que usa la aplicación (DATABASE_URL de
# backend/.env), no POSTGRES_DB: esa es solo la base con la que se inicializó
# el contenedor. Después del corte a CliniVentas la app pasó a otra base y el
# cron siguió respaldando la vieja, que ya nadie escribía. Sin backend/.env
# (una instalación solo de base) se cae a POSTGRES_DB.
app_database() {
  local url
  url="$(grep -E '^DATABASE_URL=' "$ROOT/backend/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '\r"'"'"'')"
  [[ "$url" =~ ^[a-z+]+://([^:@/]+)(:[^@]*)?@[^/]+/([^?]+) ]] || return 1
  APP_USER="${BASH_REMATCH[1]}"
  APP_DB="${BASH_REMATCH[3]}"
}
if app_database; then
  POSTGRES_DB="$APP_DB"
else
  POSTGRES_DB="$(db_env POSTGRES_DB)"
  APP_USER=""
fi
[[ "$POSTGRES_DB" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]] || { echo "ERROR: nombre de base no admitido: $POSTGRES_DB" >&2; exit 1; }
# Los backups llevan el nombre de la base: un restore no puede confundirse de
# base mirando el archivo. Los anteriores al cambio se llaman dermicapro-*.
BACKUP_GLOBS=("$POSTGRES_DB-[0-9]*.dump" "dermicapro-[0-9]*.dump")

pg_in_container() {
  # pg_hba.conf exige scram tambien por el socket local. La contrasena se toma
  # de la variable que el contenedor ya tiene, no se pasa por la linea de
  # comandos del host (quedaria visible en `ps`).
  $COMPOSE exec -T postgres sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec "$@"' sh "$@"
}

cmd_backup() {
  local stamp file
  stamp="$(date +%Y%m%d-%H%M%S)"
  file="$POSTGRES_DB-$stamp.dump"

  echo "Volcando $POSTGRES_DB ..."
  # La redireccion crea el archivo aunque pg_dump falle: sin borrarlo quedaria
  # un .dump vacio que parece un backup.
  if ! pg_in_container pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
    > "$BACKUP_DIR/$file"; then
    rm -f "$BACKUP_DIR/$file"
    echo "ERROR: pg_dump fallo; no se guardo ningun backup." >&2
    exit 1
  fi

  local size
  size="$(du -h "$BACKUP_DIR/$file" | cut -f1)"

  # Un dump de pocos bytes suele ser un error redirigido al archivo, no una
  # base vacia. Mejor fallar aqui que descubrirlo el dia de la restauracion.
  if [ "$(stat -c%s "$BACKUP_DIR/$file")" -lt 1000 ]; then
    echo "ERROR: el volcado pesa menos de 1 KB. Contenido:" >&2
    head -c 400 "$BACKUP_DIR/$file" >&2
    rm -f "$BACKUP_DIR/$file"
    exit 1
  fi

  echo "  -> db/backups/$file  ($size)"
  cmd_verify "$BACKUP_DIR/$file"

  # Poda por antiguedad. -mtime cuenta dias completos.
  local removed
  removed="$(find "$BACKUP_DIR" \( -name "${BACKUP_GLOBS[0]}" -o -name "${BACKUP_GLOBS[1]}" \) -mtime "+$KEEP_DAYS" -print -delete | wc -l)"
  [ "$removed" -gt 0 ] && echo "  purgados $removed backups de mas de $KEEP_DAYS dias"

  echo "  backups guardados: $(find "$BACKUP_DIR" \( -name "${BACKUP_GLOBS[0]}" -o -name "${BACKUP_GLOBS[1]}" \) | wc -l)"
}

cmd_verify() {
  local file="${1:-}"
  if [ -z "$file" ]; then
    file="$(find "$BACKUP_DIR" -name "${BACKUP_GLOBS[0]}" -printf '%T@ %p\n' | sort -rn | head -1 | cut -d' ' -f2-)"
  fi
  # pg_restore --list lee el indice del dump: si esta truncado o corrupto,
  # falla aqui en vez de el dia que haga falta restaurarlo.
  local tables
  tables="$($COMPOSE exec -T postgres pg_restore --list < "$file" | grep -c 'TABLE DATA' || true)"
  echo "  verificado: el volcado se lee y contiene $tables tablas con datos"
}

cmd_restore() {
  local file="$1"
  [ -f "$file" ] || { echo "No existe: $file" >&2; exit 1; }

  echo "Esto SOBRESCRIBE la base '$POSTGRES_DB' con el contenido de:"
  echo "  $file"
  read -r -p "Escribe 'restaurar' para continuar: " answer
  [ "$answer" = "restaurar" ] || { echo "Cancelado."; exit 1; }

  # --clean --if-exists deja la base en el estado del dump en vez de mezclar
  # con lo que hubiera. --role deja lo restaurado a nombre del usuario de la
  # app: restaurado como el superusuario, la app no podría ni migrar.
  local role=()
  [ -n "$APP_USER" ] && [ "$APP_USER" != "$POSTGRES_USER" ] && role=(--role="$APP_USER")
  pg_in_container pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --clean --if-exists --no-owner "${role[@]}" < "$file"
  echo "Restaurado. Revisar que la aplicacion arranca antes de dar por bueno."
}

case "${1:-}" in
  --verify)  cmd_verify "${2:-}" ;;
  --restore) cmd_restore "${2:?indica el archivo .dump}" ;;
  "")        cmd_backup ;;
  *)         echo "Uso: $0 [--verify [FILE]|--restore FILE]" >&2; exit 2 ;;
esac
