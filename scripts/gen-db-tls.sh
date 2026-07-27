#!/usr/bin/env bash
#
# Genera el certificado y la clave TLS que Postgres necesita para arrancar con
# ssl=on (ver compose.db.yml) y los deja listos en db/tls/, que es justo donde
# el compose los monta:
#
#   ./db/tls/server.crt -> /etc/postgres/server.crt
#   ./db/tls/server.key -> /etc/postgres/server.key
#
# db/tls/ esta en .gitignore: la clave privada NO se versiona y cada servidor
# genera la suya. Sin estos ficheros el contenedor de la base ni siquiera
# levanta, aunque la app local conecte en claro por la red interna de Docker.
#
# El certificado es auto-firmado. Los clientes que conectan por Internet (n8n)
# lo usan con sslmode=require: cifran, pero no verifican la CA, asi que no hace
# falta una autoridad de verdad. Aun asi se rellena el SAN por si algun cliente
# usa sslmode=verify-full.
#
# El HOST es opcional: solo fija el CN/SAN del certificado, que unicamente
# importa a clientes con sslmode=verify-full. n8n usa sslmode=require (cifra sin
# verificar el CN), asi que sin host el certificado sirve igual. Si no se pasa,
# se autodetecta la IP publica y, en su defecto, se usa el hostname de respaldo.
#
# Uso:
#   scripts/gen-db-tls.sh                 genera si faltan (autodetecta host)
#   scripts/gen-db-tls.sh HOST            usa HOST (IP o dominio) como CN/SAN
#   scripts/gen-db-tls.sh --force [HOST]  regenera aunque ya existan
#
# Tras regenerar con la base ya en marcha, recargar el certificado:
#   docker compose -f compose.db.yml --env-file db/.env restart postgres

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TLS_DIR="$ROOT/db/tls"
CRT="$TLS_DIR/server.crt"
KEY="$TLS_DIR/server.key"

# UID:GID del usuario postgres dentro de la imagen alpine (postgres:16-alpine).
# La clave privada debe pertenecer a ese usuario (o a root) y ser 0600, o
# Postgres se niega a arrancar por permisos demasiado abiertos.
PG_UID="${PG_UID:-70}"
PG_GID="${PG_GID:-70}"
DAYS="${TLS_DAYS:-3650}"

FORCE=0
HOST=""
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -*)      echo "Opcion desconocida: $arg" >&2; exit 2 ;;
    *)       HOST="$arg" ;;
  esac
done

if [ -e "$CRT" ] || [ -e "$KEY" ]; then
  if [ "$FORCE" -ne 1 ]; then
    echo "Ya existen db/tls/server.crt y/o server.key; no se toca nada."
    echo "Para regenerarlos: scripts/gen-db-tls.sh --force [HOST]"
    exit 0
  fi
  echo "--force: se regeneran los certificados existentes."
fi

# HOST es el nombre/IP por el que los clientes externos alcanzan la base. No es
# obligatorio: solo importa para clientes que verifican el certificado
# (sslmode=verify-full), y n8n conecta con sslmode=require, que cifra sin
# comprobar el CN. Por eso, si no se indica host:
#   1. se intenta la IP publica del servidor (para dejar el CN "de verdad"), y
#   2. si no hay salida a Internet, se usa el hostname de la maquina como CN de
#      respaldo y se avisa. El certificado sirve igual para cifrar; solo
#      verify-full contra ese host fallaria.
if [ -z "$HOST" ]; then
  HOST="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
  [ -n "$HOST" ] && echo "IP publica autodetectada: $HOST"
fi
if [ -z "$HOST" ]; then
  HOST="$(hostname -f 2>/dev/null || hostname 2>/dev/null || echo postgres)"
  echo "Sin host indicado y sin IP publica detectable: se usa CN de respaldo '$HOST'." >&2
  echo "El TLS cifra igual (sslmode=require); solo verify-full necesitaria el host real." >&2
  echo "Si lo necesitas, vuelve a lanzarlo con: scripts/gen-db-tls.sh --force <IP-o-dominio>" >&2
fi

# SAN: si HOST parece una IP se declara como IP, si no como DNS. Se anaden
# siempre localhost/127.0.0.1 para pruebas desde la propia maquina.
if [[ "$HOST" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SAN="IP:$HOST,DNS:localhost,IP:127.0.0.1"
else
  SAN="DNS:$HOST,DNS:localhost,IP:127.0.0.1"
fi

mkdir -p "$TLS_DIR"
umask 077  # la clave nace ya sin permisos para grupo/otros

echo "Generando par TLS para '$HOST' (validez ${DAYS} dias)..."
openssl req -x509 -newkey rsa:2048 -sha256 -nodes \
  -days "$DAYS" \
  -keyout "$KEY" \
  -out "$CRT" \
  -subj "/CN=$HOST" \
  -addext "subjectAltName=$SAN"

# Owner y permisos que exige Postgres para el fichero de clave.
chown "$PG_UID:$PG_GID" "$CRT" "$KEY"
chmod 600 "$KEY"
chmod 644 "$CRT"

echo
echo "Listo. Colocados en su sitio:"
ls -l "$CRT" "$KEY"
echo
echo "El contenedor 'postgres' ya puede arrancar con ssl=on."
echo "Si la base ya estaba en marcha, recarga el certificado con:"
echo "  docker compose -f compose.db.yml --env-file db/.env restart postgres"
