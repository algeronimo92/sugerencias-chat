#!/usr/bin/env bash
#
# Comprueba que un nginx de la landing responde como tiene que responder.
#
# landing/nginx.conf es la traducción a mano del `.htaccess` con el que la
# landing vivía en un hosting compartido, y casi todo lo que hace falla sin
# ruido: una regla mal escrita deja /privacidad en 404 (una página legal que
# Meta exige enlazar), o el HTML cacheado una semana. `nginx -t` no ve nada
# de eso; hay que pedir las URL.
#
# Lo corren CI (sobre la imagen recién construida) y scripts/deploy-landing.sh
# (sobre el contenedor candidato antes de reemplazar al que sirve).
#
# Uso: scripts/landing-smoke.sh http://127.0.0.1:8090

set -uo pipefail

BASE="${1:?uso: $0 <url base, p. ej. http://127.0.0.1:8090>}"
FAILED=0

fail() {
  echo "FALLA: $*" >&2
  FAILED=1
}

# --noproxy: siempre se le habla a un nginx local; un proxy de salida
# configurado en el entorno respondería por él.
head_of() {
  curl -sS --noproxy '*' --max-time 10 -o /dev/null -D - "${@:2}" "$BASE$1" 2>/dev/null | tr -d '\r'
}

body_of() {
  curl -sS --noproxy '*' --max-time 10 "$BASE$1" 2>/dev/null
}

status_of() {
  awk 'NR==1 {print $2}' <<<"$1"
}

header_of() { # $1=cabeceras $2=nombre
  awk -v name="$2" 'tolower($1) == tolower(name) ":" {sub(/^[^:]*: */, ""); print; exit}' <<<"$1"
}

expect_page() { # $1=ruta $2=texto que debe aparecer
  local headers body
  headers="$(head_of "$1")"
  [ "$(status_of "$headers")" = "200" ] || { fail "$1 respondió $(status_of "$headers"), se esperaba 200"; return; }
  case "$(header_of "$headers" Content-Type)" in
    text/html*) ;;
    *) fail "$1 no se sirve como HTML: $(header_of "$headers" Content-Type)" ;;
  esac
  # El HTML no se cachea: es lo que hace que un despliegue se vea de inmediato.
  case "$(header_of "$headers" Cache-Control)" in
    *max-age=0*) ;;
    *) fail "$1 quedaría cacheado: Cache-Control '$(header_of "$headers" Cache-Control)'" ;;
  esac
  body="$(body_of "$1")"
  grep -q "$2" <<<"$body" || fail "$1 no contiene '$2'"
}

expect_redirect() { # $1=ruta $2=Location esperado; el resto, opciones de curl
  local headers
  headers="$(head_of "$1" "${@:3}")"
  [ "$(status_of "$headers")" = "301" ] || { fail "$1 respondió $(status_of "$headers"), se esperaba 301"; return; }
  [ "$(header_of "$headers" Location)" = "$2" ] \
    || fail "$1 redirige a '$(header_of "$headers" Location)', se esperaba '$2'"
}

# -- Las páginas, sin .html en la URL -----------------------------------------
expect_page / "CliniVentas"
expect_page /privacidad "CliniVentas"
expect_page /tratamiento-de-datos "CliniVentas"
expect_page /login "Entra a tu cuenta"

# -- Una sola URL por página ---------------------------------------------------
expect_redirect /privacidad/ /privacidad
expect_redirect /privacidad.html /privacidad
expect_redirect "/privacidad.html?utm=x" "/privacidad?utm=x"
expect_redirect /index.html /
expect_redirect "/privacidad?utm=x" "https://cliniventas.com/privacidad?utm=x" -H "Host: www.cliniventas.com"

# -- Lo que no existe: 404 con la página propia y con cabeceras ---------------
headers="$(head_of /esta-pagina-no-existe)"
[ "$(status_of "$headers")" = "404" ] || fail "una ruta inexistente respondió $(status_of "$headers"), se esperaba 404"
body_of /esta-pagina-no-existe | grep -q "Esta página no existe" \
  || fail "el 404 no es la página propia (src/app/not-found.tsx)"
[ "$(header_of "$headers" X-Content-Type-Options)" = "nosniff" ] \
  || fail "las cabeceras de seguridad no llegan en las respuestas de error"
[ "$(status_of "$(head_of /.htaccess)")" = "404" ] || fail "se puede pedir un archivo oculto"

# -- Cabeceras de seguridad en una página normal ------------------------------
headers="$(head_of /)"
for name in X-Content-Type-Options X-Frame-Options Referrer-Policy Permissions-Policy; do
  [ -n "$(header_of "$headers" "$name")" ] || fail "falta la cabecera $name en /"
done
[ "$(header_of "$(head_of / -H 'Accept-Encoding: gzip')" Content-Encoding)" = "gzip" ] \
  || fail "/ no sale comprimido"

# -- Navegación sin recarga: Next pide el .txt de la ruta ---------------------
headers="$(head_of /privacidad.txt)"
[ "$(status_of "$headers")" = "200" ] || fail "/privacidad.txt respondió $(status_of "$headers"): la navegación sin recarga recargaría la página entera"

# -- Assets con hash: cacheados en firme --------------------------------------
asset="$(body_of / | grep -o '/_next/static/[^"]*\.css' | head -1)"
if [ -z "$asset" ]; then
  fail "la portada no referencia ninguna hoja de estilos de /_next/static/"
else
  headers="$(head_of "$asset")"
  [ "$(status_of "$headers")" = "200" ] || fail "$asset respondió $(status_of "$headers")"
  case "$(header_of "$headers" Cache-Control)" in
    *immutable*) ;;
    *) fail "$asset no se cachea en firme: '$(header_of "$headers" Cache-Control)'" ;;
  esac
  case "$(header_of "$headers" Content-Type)" in
    text/css*) ;;
    *) fail "$asset se sirve como '$(header_of "$headers" Content-Type)': el navegador lo descarta" ;;
  esac
fi

if [ "$FAILED" -ne 0 ]; then
  echo "La landing en $BASE NO responde como se espera." >&2
  exit 1
fi
echo "Landing en $BASE: rutas, redirecciones, caché y cabeceras correctas."
