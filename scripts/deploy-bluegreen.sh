#!/usr/bin/env bash
#
# Despliegue blue-green.
#
# La versión nueva se levanta al lado de la que está sirviendo, se migra y se
# comprueba mientras nadie la usa todavía. Sólo cuando responde sana se
# reescribe traefik/dynamic/active.yml, que traefik relee en caliente: el
# tráfico cambia de instancia sin recrear un contenedor ni cortar un segundo.
#
# Si algo falla antes de conmutar, el color viejo nunca dejó de servir y no
# hubo interrupción. Si falla después, se vuelve a escribir el archivo con el
# puerto anterior y el tráfico regresa en menos de un segundo.
#
# Requisito de las migraciones: durante la ventana en que ambos colores están
# vivos, el esquema tiene que servir a los dos. Por eso las migraciones deben
# ser aditivas (expandir ahora, contraer en un despliegue posterior). Un DROP
# COLUMN en la misma versión que deja de usarla rompe al color viejo mientras
# se apaga.
#
# Uso:
#   scripts/deploy-bluegreen.sh            despliega el color inactivo
#   scripts/deploy-bluegreen.sh --rollback vuelve al color anterior
#   scripts/deploy-bluegreen.sh --status   muestra qué color sirve

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ACTIVE_FILE="$ROOT/traefik/dynamic/active.yml"
DOMAIN="${DEPLOY_DOMAIN:-chat.dermicapro.app}"
HEALTH_ATTEMPTS="${HEALTH_ATTEMPTS:-40}"
HEALTH_INTERVAL="${HEALTH_INTERVAL:-5}"

declare -A PORT=([blue]=8081 [green]=8082)

compose_for() {
  local color="$1"
  echo "docker compose -p sugerencias-chat-$color -f $ROOT/compose.prod.yml -f $ROOT/compose.bluegreen.yml"
}

active_color() {
  # El archivo que enruta el tráfico es la única fuente de verdad. Un archivo
  # de estado aparte podría desincronizarse justo cuando más importa.
  local port
  port="$(grep -oE 'http://127\.0\.0\.1:[0-9]+' "$ACTIVE_FILE" | grep -oE '[0-9]+$' | head -1)"
  for color in "${!PORT[@]}"; do
    [ "${PORT[$color]}" = "$port" ] && { echo "$color"; return 0; }
  done
  echo "blue"
}

write_active() {
  local color="$1" port="${PORT[$1]}" tmp
  tmp="$(mktemp)"
  sed -e "s|http://127\.0\.0\.1:[0-9]\+|http://127.0.0.1:$port|" \
      -e "s|^# ACTIVE_COLOR: .*|# ACTIVE_COLOR: $color|" \
      "$ACTIVE_FILE" > "$tmp"
  # mv es atómico dentro del mismo sistema de archivos: traefik nunca llega a
  # leer un archivo a medio escribir.
  mv "$tmp" "$ACTIVE_FILE"
  echo "Tráfico apuntando a $color (127.0.0.1:$port)"
}

healthy() {
  local color="$1" port="${PORT[$1]}" compose attempt=0
  compose="$(compose_for "$color")"
  while [ "$attempt" -lt "$HEALTH_ATTEMPTS" ]; do
    if $compose exec -T backend python -c \
         "import urllib.request; urllib.request.urlopen('http://localhost:8000/health/ready', timeout=5)" \
         >/dev/null 2>&1 \
       && curl -fsS -o /dev/null "http://127.0.0.1:$port/"; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep "$HEALTH_INTERVAL"
  done
  return 1
}

serving_through_traefik() {
  # Comprueba el camino real de un usuario, no sólo el puerto interno.
  curl -fsSk -o /dev/null --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/"
}

running_containers() {
  # `ps -q` sobre un proyecto inexistente no falla, devuelve vacío; se cuentan
  # sólo líneas no vacías para no contar una línea en blanco como contenedor.
  $(compose_for "$1") ps -q 2>/dev/null | grep -c . || true
}

cmd_status() {
  local active; active="$(active_color)"
  echo "Color activo: $active (puerto ${PORT[$active]})"
  for color in blue green; do
    echo "  $color: $(running_containers "$color") contenedores"
  done
}

cmd_rollback() {
  local active target
  active="$(active_color)"
  target="$([ "$active" = blue ] && echo green || echo blue)"
  if [ -z "$($(compose_for "$target") ps -q 2>/dev/null)" ]; then
    echo "ERROR: $target no está levantado, no hay a dónde volver" >&2
    exit 1
  fi
  write_active "$target"
  sleep 2
  serving_through_traefik && echo "Reversión a $target completada"
}

cmd_deploy() {
  local active target compose_target
  active="$(active_color)"
  target="$([ "$active" = blue ] && echo green || echo blue)"
  compose_target="$(compose_for "$target")"

  echo "Sirviendo: $active. Desplegando en: $target (puerto ${PORT[$target]})"

  COLOR_PORT="${PORT[$target]}" $compose_target up -d --build

  # Antes de conmutar: si el esquema no queda listo, el color viejo sigue
  # sirviendo y aquí no ha pasado nada.
  echo "Aplicando migraciones..."
  $compose_target run --rm --no-deps backend python -m scripts.migrate

  echo "Esperando a que $target responda sano..."
  if ! healthy "$target"; then
    echo "ERROR: $target no llegó a estar sano. No se conmuta." >&2
    echo "$active sigue sirviendo con normalidad. Logs del color fallido:" >&2
    $compose_target logs --tail 40 backend >&2 || true
    COLOR_PORT="${PORT[$target]}" $compose_target down || true
    exit 1
  fi

  write_active "$target"
  sleep 2

  if ! serving_through_traefik; then
    echo "ERROR: traefik no sirve $target. Revirtiendo a $active." >&2
    write_active "$active"
    exit 1
  fi

  echo "Conmutado a $target. Verificado a través de traefik."

  # El color viejo se apaga al final y no se borra su imagen: es la reversión
  # inmediata durante los próximos despliegues.
  COLOR_PORT="${PORT[$active]}" $(compose_for "$active") down || true
  echo "Color anterior ($active) detenido. Despliegue completo."
}

# Sólo despacha cuando se ejecuta, no cuando se hace `source`. Así los tests
# pueden ejercitar las funciones reales —conmutar de color es lo que más
# fácil se rompe— en vez de reimplementar su lógica y probar otra cosa.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  case "${1:-}" in
    --status)   cmd_status ;;
    --rollback) cmd_rollback ;;
    "")         cmd_deploy ;;
    *)          echo "Uso: $0 [--status|--rollback]" >&2; exit 2 ;;
  esac
fi
