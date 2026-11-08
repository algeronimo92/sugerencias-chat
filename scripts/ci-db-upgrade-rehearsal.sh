#!/usr/bin/env bash
#
# Ensaya en CI el reemplazo de la imagen de PostgreSQL que hace el deploy.
#
# El deploy construye db/Dockerfile en el servidor y recrea la base sobre el
# volumen que tiene los datos de producción. Un error ahí no se ve hasta ese
# momento, así que se ensaya acá, antes del merge:
#
# 1. El tag de compose.db.yml y compose.yml nombra las versiones del
#    Dockerfile. Compose solo construye cuando el tag no existe en el servidor:
#    un Dockerfile nuevo con el tag viejo no se aplicaría nunca.
# 2. Se crean datos con la imagen base (la que corre hoy), incluido texto con
#    tildes y emoji y un índice sobre él.
# 3. La imagen nueva arranca sobre ese mismo volumen.
# 4. pgvector se puede crear y funciona, los datos siguen ahí y amcheck no
#    encuentra índices de texto rotos: es lo que se rompería si la imagen
#    cambiara de sistema base (alpine/musl → Debian/glibc) bajo los datos.
#
# Uso (lo corre ci-cd.yml, job docker-build-check):
#   scripts/ci-db-upgrade-rehearsal.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DOCKERFILE="$ROOT/db/Dockerfile"

BASE_IMAGE="$(sed -n 's/^FROM[[:space:]]\{1,\}\([^[:space:]]*\).*/\1/p' "$DOCKERFILE" | head -1)"
PG_VERSION="$(printf '%s' "$BASE_IMAGE" | sed -n 's/^postgres:\([0-9][0-9.]*\)-alpine$/\1/p')"
PGVECTOR_VERSION="$(sed -n 's/^ARG PGVECTOR_VERSION=\(.*\)$/\1/p' "$DOCKERFILE" | head -1)"
if [ -z "$PG_VERSION" ] || [ -z "$PGVECTOR_VERSION" ]; then
  echo "ERROR: no se pudo leer 'FROM postgres:<versión>-alpine' o 'ARG PGVECTOR_VERSION=' de db/Dockerfile." >&2
  exit 1
fi
IMAGE="cliniventas-postgres:${PG_VERSION}-pgvector-${PGVECTOR_VERSION}"

for compose in compose.db.yml compose.yml; do
  if ! grep -qE "^[[:space:]]*image:[[:space:]]*${IMAGE//./\\.}[[:space:]]*$" "$ROOT/$compose"; then
    echo "ERROR: $compose debe usar 'image: $IMAGE' (las versiones de db/Dockerfile)." >&2
    echo "Con otro tag, el servidor no reconstruiría la imagen al desplegar." >&2
    exit 1
  fi
done

VOLUME="pg-rehearsal-$$"
cleanup() {
  docker rm -f pg-old pg-new >/dev/null 2>&1 || true
  docker volume rm "$VOLUME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

run_pg() { # $1=nombre $2=imagen
  docker run -d --name "$1" -e POSTGRES_PASSWORD=rehearsal -e POSTGRES_DB=app \
    -v "$VOLUME:/var/lib/postgresql/data" "$2" >/dev/null
}

wait_pg() { # $1=nombre
  # Por TCP: durante la inicialización el servidor temporal solo escucha en
  # el socket, y pg_isready por socket daría "listo" antes de tiempo.
  for _ in $(seq 1 60); do
    if docker exec "$1" pg_isready -h 127.0.0.1 -U postgres -d app -q; then
      return 0
    fi
    sleep 1
  done
  echo "ERROR: $1 no quedó aceptando conexiones." >&2
  docker logs "$1" >&2
  exit 1
}

sql() { # $1=nombre $2=sql
  docker exec "$1" psql -v ON_ERROR_STOP=1 -U postgres -d app -Atc "$2"
}

echo "Construyendo $IMAGE"
docker build -t "$IMAGE" "$ROOT/db"

echo "Datos con la imagen actual ($BASE_IMAGE)"
run_pg pg-old "$BASE_IMAGE"
wait_pg pg-old
sql pg-old "CREATE TABLE textos (t text); CREATE INDEX textos_t ON textos (t);"
sql pg-old "INSERT INTO textos SELECT unnest(ARRAY['Ñandú','ñandu','Árbol','arbol','Zoe','zoé','Émile','émile','a','B','😊 hola','Hollywood Peel - Rostro']) || g FROM generate_series(1, 500) AS g;"
FILAS="$(sql pg-old "SELECT count(*) FROM textos")"
docker stop pg-old >/dev/null
docker rm pg-old >/dev/null

echo "La imagen nueva sobre el mismo volumen"
run_pg pg-new "$IMAGE"
wait_pg pg-new
sql pg-new "CREATE EXTENSION vector WITH SCHEMA public; CREATE EXTENSION amcheck;"
echo "  pgvector $(sql pg-new "SELECT extversion FROM pg_extension WHERE extname = 'vector'")"
[ "$(sql pg-new "SELECT count(*) FROM textos")" = "$FILAS" ] || { echo "ERROR: se perdieron filas" >&2; exit 1; }
# heapallindexed: además del orden del árbol, que cada fila esté en el índice.
sql pg-new "SELECT bt_index_check('textos_t'::regclass, true)" >/dev/null
[ "$(sql pg-new "SELECT round((('[1,0,0]'::vector <=> '[0,1,0]'::vector))::numeric, 3)")" = "1.000" ] || {
  echo "ERROR: pgvector no calcula la distancia coseno esperada" >&2; exit 1; }
sql pg-new "CREATE TABLE fragmentos (e vector(3)); INSERT INTO fragmentos VALUES ('[0.1,0.2,0.3]'), (CAST(ARRAY[1,2,3]::real[] AS vector));" >/dev/null
echo "Ensayo correcto: $FILAS filas intactas, índices de texto sanos, pgvector funcionando."
