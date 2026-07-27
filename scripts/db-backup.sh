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
COMPOSE="docker compose -f $ROOT/docker-compose.db.yml --env-file $ROOT/db/.env"
BACKUP_DIR="$ROOT/db/backups"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

db_env() {
  # Se leen del mismo .env que usa el compose, para no duplicar credenciales.
  grep -E "^$1=" "$ROOT/db/.env" | head -1 | cut -d= -f2-
}

POSTGRES_USER="$(db_env POSTGRES_USER)"
POSTGRES_DB="$(db_env POSTGRES_DB)"

cmd_backup() {
  local stamp file
  stamp="$(date +%Y%m%d-%H%M%S)"
  file="dermicapro-$stamp.dump"

  echo "Volcando $POSTGRES_DB ..."
  $COMPOSE exec -T postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc \
    > "$BACKUP_DIR/$file"

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
  removed="$(find "$BACKUP_DIR" -name 'dermicapro-*.dump' -mtime "+$KEEP_DAYS" -print -delete | wc -l)"
  [ "$removed" -gt 0 ] && echo "  purgados $removed backups de mas de $KEEP_DAYS dias"

  echo "  backups guardados: $(find "$BACKUP_DIR" -name 'dermicapro-*.dump' | wc -l)"
}

cmd_verify() {
  local file="${1:-}"
  if [ -z "$file" ]; then
    file="$(find "$BACKUP_DIR" -name 'dermicapro-*.dump' -printf '%T@ %p\n' | sort -rn | head -1 | cut -d' ' -f2-)"
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
  # con lo que hubiera.
  $COMPOSE exec -T postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
    --clean --if-exists --no-owner < "$file"
  echo "Restaurado. Revisar que la aplicacion arranca antes de dar por bueno."
}

case "${1:-}" in
  --verify)  cmd_verify "${2:-}" ;;
  --restore) cmd_restore "${2:?indica el archivo .dump}" ;;
  "")        cmd_backup ;;
  *)         echo "Uso: $0 [--verify [FILE]|--restore FILE]" >&2; exit 2 ;;
esac
