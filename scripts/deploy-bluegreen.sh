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
# Proyecto de compose del despliegue anterior a blue-green, el que enruta por
# etiquetas de Docker (compose.prod.yml + traefik/docker-compose.yml). Los
# colores usan "$LEGACY_PROJECT-blue" y "-green", nombres distintos.
LEGACY_PROJECT="sugerencias-chat"

declare -A PORT=([blue]=8081 [green]=8082)
# Puerto de solo-métricas de cada color (ver frontend/nginx.conf: un `server`
# aparte que ningún router de Traefik referencia). Numerado aparte de PORT
# para que quede obvio en `docker ps`/logs cuál es cuál.
declare -A METRICS_PORT=([blue]=9081 [green]=9082)

compose_for() {
  local color="$1"
  # COLOR_PORT/METRICS_PORT van embebidos acá, no como prefijo en cada call
  # site: compose.bluegreen.yml los exige para interpolar (${COLOR_PORT:?...},
  # ${METRICS_PORT:?...}), y ese error de interpolación ocurre al parsear el
  # archivo, así que CUALQUIER subcomando (up, run, exec, logs, down, ps) los
  # necesita — no solo "up". Confiar en que cada call site los prefije a mano
  # ya rompió migrate() en producción porque esa llamada no lo tenía.
  echo "env COLOR_PORT=${PORT[$color]} METRICS_PORT=${METRICS_PORT[$color]} docker compose -p sugerencias-chat-$color -f $ROOT/compose.prod.yml -f $ROOT/compose.bluegreen.yml"
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

stop_legacy_stack() {
  # El stack anterior a blue-green (proyecto "sugerencias-chat", enrutado por
  # etiquetas) no puede convivir con los colores: su router reclama el mismo
  # Host que el del archivo dinámico y traefik tiene los dos proveedores
  # activos, así que sirve el suyo pase lo que pase en active.yml.
  #
  # No es hipotético: quedó levantado tras migrar a blue-green y durante días
  # los despliegues construyeron, migraron la base y conmutaron el color
  # mientras los usuarios seguían recibiendo los contenedores viejos. Con el
  # esquema ya migrado, ese código antiguo devolvía 500 en /api/automations
  # porque no conocía los valores nuevos de la base.
  local ids
  # Igualdad exacta: no alcanza a "$LEGACY_PROJECT-blue" ni a "-green".
  ids="$(docker ps -q --filter "label=com.docker.compose.project=$LEGACY_PROJECT" 2>/dev/null || true)"
  [ -n "$ids" ] || return 0
  echo "Parando el stack heredado ($LEGACY_PROJECT): reclama el mismo Host que blue-green"
  # shellcheck disable=SC2086 - son varios ids separados por saltos de línea.
  docker rm -f $ids >/dev/null
}

serving_through_traefik() {
  # Comprueba el camino real de un usuario y, además, que lo que le llega es lo
  # que sirve el color recién desplegado. Que responda 200 no basta: cuando
  # otro contenedor reclama el dominio, esta comprobación la pasaba él y el
  # despliegue se daba por bueno sin que nadie llegara a ver la versión nueva.
  local port="${PORT[$1]}" direct via
  direct="$(curl -fsS "http://127.0.0.1:$port/" 2>/dev/null | sha256sum)" || return 1
  via="$(curl -fsSk --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" 2>/dev/null | sha256sum)" || return 1
  [ "$direct" = "$via" ]
}

routing_diagnostics() {
  echo "Lo que traefik está sirviendo ahora mismo:" >&2
  curl -sIk --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" 2>&1 | sed 's/^/  /' >&2 || true
  echo "Contenedores vivos que pueden estar reclamando $DOMAIN:" >&2
  docker ps --format '  {{.Names}}  {{.Image}}  {{.Status}}' >&2 || true
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
  local legacy
  legacy="$(docker ps -q --filter "label=com.docker.compose.project=$LEGACY_PROJECT" 2>/dev/null | grep -c . || true)"
  if [ "$legacy" != "0" ]; then
    echo "  AVISO: el stack heredado ($LEGACY_PROJECT) tiene $legacy contenedores vivos"
    echo "  y reclama el mismo Host: es él quien sirve, no el color activo."
  fi
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
  stop_legacy_stack
  sleep 2
  if ! serving_through_traefik "$target"; then
    echo "ERROR: traefik no está sirviendo $target pese a la reversión." >&2
    routing_diagnostics
    exit 1
  fi
  echo "Reversión a $target completada"
}

cmd_deploy() {
  local active target compose_target
  active="$(active_color)"
  target="$([ "$active" = blue ] && echo green || echo blue)"
  compose_target="$(compose_for "$target")"

  echo "Sirviendo: $active. Desplegando en: $target (puerto ${PORT[$target]})"

  $compose_target up -d --build

  # Antes de conmutar: si el esquema no queda listo, el color viejo sigue
  # sirviendo y aquí no ha pasado nada.
  echo "Aplicando migraciones..."
  $compose_target run --rm --no-deps backend python -m scripts.migrate

  echo "Esperando a que $target responda sano..."
  if ! healthy "$target"; then
    echo "ERROR: $target no llegó a estar sano. No se conmuta." >&2
    echo "$active sigue sirviendo con normalidad. Logs del color fallido:" >&2
    $compose_target logs --tail 40 backend >&2 || true
    $compose_target down || true
    exit 1
  fi

  write_active "$target"
  # Después de conmutar y antes de comprobar: mientras el heredado siga vivo,
  # active.yml no decide nada y la comprobación de abajo mediría a otro.
  stop_legacy_stack
  sleep 2

  if ! serving_through_traefik "$target"; then
    echo "ERROR: traefik no sirve $target. Revirtiendo a $active." >&2
    routing_diagnostics
    write_active "$active"
    exit 1
  fi

  echo "Conmutado a $target. Verificado a través de traefik."

  # El color viejo se apaga al final y no se borra su imagen: es la reversión
  # inmediata durante los próximos despliegues.
  $(compose_for "$active") down || true
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
