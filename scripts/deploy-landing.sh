#!/usr/bin/env bash
#
# Despliegue de la landing (cliniventas.com).
#
# La landing es HTML estático dentro de un nginx (landing/, compose.landing.yml)
# y no participa del blue-green del CRM. Aun así no se reemplaza a ciegas: la
# imagen nueva se construye y se prueba en un contenedor aparte, que nadie
# visita, y recién cuando responde bien ocupa el lugar de la que sirve. Si la
# versión nueva no compila o no responde, la landing publicada ni se entera.
#
# Qué versión está sirviendo se lee del tag de la imagen del contenedor, que
# es el hash del árbol landing/ en git. No se decide con un `git diff` entre
# el commit anterior y el nuevo: si un despliegue de la landing falla, el
# siguiente ya no vería diferencias y la dejaría sin desplegar para siempre.
#
# Uso:
#   scripts/deploy-landing.sh            despliega si landing/ cambió
#   scripts/deploy-landing.sh --status   muestra qué versión sirve

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
COMPOSE_FILE="$ROOT/compose.landing.yml"
SMOKE="$ROOT/scripts/landing-smoke.sh"
IMAGE="cliniventas-landing"
DOMAIN="${LANDING_DOMAIN:-cliniventas.com}"
# El que publica compose.landing.yml y referencia traefik/dynamic/landing.yml.
PORT=8090
# Donde se prueba la imagen nueva antes de servirla. Ningún router de traefik
# lo referencia.
CANDIDATE_PORT=8091
CANDIDATE_NAME="cliniventas-landing-candidato"
READY_ATTEMPTS="${READY_ATTEMPTS:-20}"
READY_INTERVAL="${READY_INTERVAL:-1}"

compose() { # $1=revisión; el resto, el subcomando
  env LANDING_REVISION="$1" docker compose -f "$COMPOSE_FILE" "${@:2}"
}

revision() {
  # Hash del árbol, no del commit: solo cambia cuando cambia algo dentro de
  # landing/, así que un despliegue que toca solo el CRM no reconstruye nada.
  git -C "$ROOT" rev-parse HEAD:landing
}

serving_revision() {
  local container
  container="$(compose dev ps -q --status running landing 2>/dev/null | head -1)"
  [ -n "$container" ] || return 0
  docker inspect -f '{{.Config.Image}}' "$container" 2>/dev/null | sed -n "s/^$IMAGE://p"
}

wait_ready() { # $1=puerto
  local attempt=0
  while [ "$attempt" -lt "$READY_ATTEMPTS" ]; do
    curl -fsS --noproxy '*' -o /dev/null "http://127.0.0.1:$1/" 2>/dev/null && return 0
    attempt=$((attempt + 1))
    sleep "$READY_INTERVAL"
  done
  return 1
}

smoke() { # $1=puerto
  "$SMOKE" "http://127.0.0.1:$1"
}

discard_candidate() {
  docker rm -f "$CANDIDATE_NAME" >/dev/null 2>&1 || true
}

serving_through_traefik() {
  # Lo mismo que comprueba el blue-green: que por el dominio llega lo que
  # sirve ESTE contenedor, y no otro router que reclame el mismo Host. Acá el
  # candidato a quitárselo es el del CRM: `www.cliniventas.com` encaja en su
  # HostRegexp, y si ganara él `www` respondería "negocio no encontrado".
  #
  # -k porque el certificado puede no estar emitido todavía en el primer
  # despliegue; --resolve porque el DNS puede seguir apuntando al hosting
  # anterior. Se comprueba el enrutado, no el certificado ni el DNS.
  local direct via www
  direct="$(curl -fsS --noproxy '*' "http://127.0.0.1:$PORT/" 2>/dev/null | sha256sum)" || return 1
  via="$(curl -fsSk --noproxy '*' --resolve "$DOMAIN:443:127.0.0.1" "https://$DOMAIN/" 2>/dev/null | sha256sum)" || return 1
  [ "$direct" = "$via" ] || return 1
  www="$(curl -sSk --noproxy '*' -o /dev/null -w '%{redirect_url}' \
    --resolve "www.$DOMAIN:443:127.0.0.1" "https://www.$DOMAIN/" 2>/dev/null)" || return 1
  [ "$www" = "https://$DOMAIN/" ]
}

wait_serving_through_traefik() {
  # traefik tarda hasta el intervalo de su healthCheck (10 s en landing.yml)
  # en dar por sano un servidor que acaba de reaparecer: se reintenta, igual
  # que en deploy-bluegreen.sh.
  local attempts="${TRAEFIK_ATTEMPTS:-8}" interval="${TRAEFIK_INTERVAL:-3}" attempt=0
  while [ "$attempt" -lt "$attempts" ]; do
    serving_through_traefik && return 0
    attempt=$((attempt + 1))
    sleep "$interval"
  done
  return 1
}

prune_images() { # se conservan las revisiones que se pasan como argumentos
  local tag
  docker images "$IMAGE" --format '{{.Tag}}' 2>/dev/null | while read -r tag; do
    case " $* " in *" $tag "*) continue ;; esac
    docker rmi "$IMAGE:$tag" >/dev/null 2>&1 || true
  done
}

cmd_status() {
  local serving; serving="$(serving_revision)"
  echo "Landing en el repositorio: $(revision)"
  echo "Landing sirviendo:         ${serving:-ninguna (el contenedor no está corriendo)}"
}

cmd_deploy() {
  local target serving
  target="$(revision)"
  serving="$(serving_revision)"

  if [ "$target" = "$serving" ]; then
    echo "Landing sin cambios ($target)."
    # Igual se pasa por `up`: aplica un cambio de compose.landing.yml (el
    # puerto, el healthcheck) y, si no hay ninguno, no recrea nada.
    compose "$target" up -d --wait
    return 0
  fi

  echo "Landing sirviendo: ${serving:-ninguna}. Desplegando: $target"
  compose "$target" build

  # La imagen nueva, en un contenedor que nadie visita.
  discard_candidate
  docker run -d --name "$CANDIDATE_NAME" -p "127.0.0.1:$CANDIDATE_PORT:80" "$IMAGE:$target" >/dev/null
  if ! wait_ready "$CANDIDATE_PORT" || ! smoke "$CANDIDATE_PORT"; then
    echo "ERROR: la landing nueva no responde como se espera. No se reemplaza." >&2
    echo "Sigue publicada la versión ${serving:-anterior}. Logs del candidato:" >&2
    docker logs --tail 20 "$CANDIDATE_NAME" >&2 || true
    discard_candidate
    exit 1
  fi
  discard_candidate

  # El corte dura lo que tarda nginx en arrancar: la imagen ya está construida
  # y probada. --wait espera al healthcheck del contenedor.
  compose "$target" up -d --wait

  if ! wait_ready "$PORT" || ! smoke "$PORT"; then
    echo "ERROR: la landing no responde tras el reemplazo." >&2
    if [ -n "$serving" ]; then
      echo "Volviendo a la versión $serving." >&2
      compose "$serving" up -d --wait || true
    fi
    exit 1
  fi

  if ! wait_serving_through_traefik; then
    # No se revierte el contenedor: responde bien, lo roto es el enrutado, y
    # volver a la imagen anterior no lo arreglaría.
    echo "ERROR: la landing responde en 127.0.0.1:$PORT pero traefik no la sirve en $DOMAIN." >&2
    echo "Revisar traefik/dynamic/landing.yml y los logs de traefik." >&2
    exit 1
  fi

  echo "Landing desplegada ($target). Verificada a través de traefik."
  # La anterior se conserva con su tag: es la reversión sin reconstruir.
  prune_images "$target" "$serving"
}

# Solo despacha cuando se ejecuta, no cuando se hace `source`: los tests
# ejercitan estas funciones con un docker de mentira.
if [ "${BASH_SOURCE[0]}" = "${0}" ]; then
  case "${1:-}" in
    --status) cmd_status ;;
    "")       cmd_deploy ;;
    *)        echo "Uso: $0 [--status]" >&2; exit 2 ;;
  esac
fi
