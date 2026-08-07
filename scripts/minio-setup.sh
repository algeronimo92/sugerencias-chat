#!/usr/bin/env bash
#
# Prepara MinIO para la aplicacion: bucket, politica de minimo privilegio y
# usuario de servicio.
#
# Se hace con script y no a mano en la consola para que sea repetible: si hay
# que rehacerlo -como acaba de pasar-, es un comando en vez de reconstruir de
# memoria que permisos llevaba.
#
# Es IDEMPOTENTE: volver a ejecutarlo con la infraestructura ya montada no
# cambia nada y no toca la credencial en uso. Antes borraba politica y usuario
# para recrearlos y generaba un secreto nuevo en cada corrida, asi que
# reejecutarlo -por ejemplo para revisar los permisos- dejaba al backend en
# produccion con una credencial invalida hasta editar el .env a mano.
#
# Para rotar el secreto a proposito:
#
#   scripts/minio-setup.sh --rotate-secret
#
# El usuario que crea NO es el root de MinIO. Solo puede leer, escribir y
# borrar objetos dentro de su bucket: no puede listar otros buckets, ni
# crearlos, ni borrarlos, ni tocar politicas. Si esa credencial se filtra, el
# alcance es un bucket.
#
# Requiere las credenciales ROOT de MinIO, que solo se usan aqui y no quedan
# guardadas en ningun sitio:
#
#   MINIO_ROOT_USER=admin MINIO_ROOT_PASSWORD=... scripts/minio-setup.sh
#
# Usa la imagen oficial de `mc` via docker, asi que no hay que instalar nada.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT/backend/.env"

ROTATE_SECRET=false
for arg in "$@"; do
  case "$arg" in
    --rotate-secret) ROTATE_SECRET=true ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^#\s\?//'
      exit 0
      ;;
    *) echo "opcion desconocida: $arg" >&2; exit 2 ;;
  esac
done

read_env() {
  grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'" || true
}

ENDPOINT="${MINIO_ENDPOINT:-$(read_env MINIO_ENDPOINT)}"
BUCKET="${MINIO_BUCKET:-$(read_env MINIO_BUCKET)}"
SECURE="${MINIO_SECURE:-$(read_env MINIO_SECURE)}"
APP_USER="${MINIO_APP_USER:-dermicapro-app}"

: "${MINIO_ROOT_USER:?define MINIO_ROOT_USER (credencial root de MinIO)}"
: "${MINIO_ROOT_PASSWORD:?define MINIO_ROOT_PASSWORD}"
: "${ENDPOINT:?no se encontro MINIO_ENDPOINT en backend/.env}"
: "${BUCKET:?no se encontro MINIO_BUCKET en backend/.env}"

SCHEME="https"
[ "$SECURE" = "false" ] && SCHEME="http"
URL="$SCHEME://$ENDPOINT"

echo "Servidor : $URL"
echo "Bucket   : $BUCKET"
echo "Usuario  : $APP_USER"

# Se consulta si el usuario ya existe ANTES de generar nada: el secreto solo
# se toca cuando hay que crearlo o cuando se pide la rotacion explicitamente.
# Generarlo siempre era lo que invalidaba la credencial del backend en cada
# corrida.
if docker run --rm \
  -e MC_HOST_target="$SCHEME://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@$ENDPOINT" \
  --entrypoint mc minio/mc admin user info target "$APP_USER" >/dev/null 2>&1; then
  USER_EXISTS=true
else
  USER_EXISTS=false
fi

# Secreto de 40 caracteres, como los que genera MinIO.
if [ "$USER_EXISTS" = false ] || [ "$ROTATE_SECRET" = true ] || [ -n "${MINIO_APP_SECRET:-}" ]; then
  APP_SECRET="${MINIO_APP_SECRET:-$(head -c 30 /dev/urandom | base64 | tr -d '/+=' | head -c 40)}"
else
  # Vacio = no tocar la credencial. MinIO no permite releer un secreto ya
  # creado, asi que tampoco se puede mostrar: si se perdio, hay que rotarlo.
  APP_SECRET=""
fi

if [ "$USER_EXISTS" = true ] && [ -z "$APP_SECRET" ]; then
  echo "Secreto  : sin cambios (usar --rotate-secret para generar uno nuevo)"
elif [ "$USER_EXISTS" = true ]; then
  echo "Secreto  : SE VA A ROTAR (el backend dejara de autenticar hasta actualizar el .env)"
else
  echo "Secreto  : se genera uno nuevo (el usuario no existe todavia)"
fi

# La politica se genera aqui, y su alcance se deriva de MINIO_PREFIX, para que
# no pueda quedar desincronizada con donde la aplicacion escribe de verdad.
#
# Los permisos salen de lo que usa services/media_storage.py:
#   bucket_exists -> ListBucket        put_object/fput_object -> PutObject
#   get_object    -> GetObject         remove_object          -> DeleteObject
#   stat_object   -> GetObject
#
# Las acciones de multipart no son opcionales: el SDK de MinIO parte solo los
# objetos grandes, y el limite de subida de la app son 25 MB. Sin ellas, las
# imagenes pequenas subirian y los videos fallarian con AccessDenied — un
# fallo intermitente y dificil de atribuir.
#
# El ambito son las claves bajo el prefijo, no todo el bucket: las claves son
# {prefijo}/{categoria}/{archivo} (ver _object_name_candidates).
PREFIX="${MINIO_PREFIX:-$(read_env MINIO_PREFIX)}"
PREFIX="${PREFIX%/}"
OBJECT_ARN="arn:aws:s3:::$BUCKET/*"
[ -n "$PREFIX" ] && OBJECT_ARN="arn:aws:s3:::$BUCKET/$PREFIX/*"

echo "Alcance  : $OBJECT_ARN"
echo

POLICY=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BucketAccess",
      "Effect": "Allow",
      "Action": [
        "s3:GetBucketLocation",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads"
      ],
      "Resource": ["arn:aws:s3:::$BUCKET"]
    },
    {
      "Sid": "MediaObjectAccess",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:DeleteObject",
        "s3:AbortMultipartUpload",
        "s3:ListMultipartUploadParts"
      ],
      "Resource": ["$OBJECT_ARN"]
    }
  ]
}
JSON
)

# La politica viaja por variable de entorno y no interpolada en el script: al
# incrustar el JSON dentro de un `echo "..."`, sus comillas internas se
# rompen y mc recibe `{ Version: ...` sin comillar, que rechaza con
# "invalid character 'V' looking for beginning of object key string".
docker run --rm -i \
  -e MC_HOST_target="$SCHEME://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@$ENDPOINT" \
  -e POLICY_JSON="$POLICY" \
  -e BUCKET="$BUCKET" \
  -e APP_USER="$APP_USER" \
  -e APP_SECRET="$APP_SECRET" \
  --entrypoint sh minio/mc -s <<'SCRIPT'
set -e

printf '%s' "$POLICY_JSON" > /tmp/policy.json

echo "--- bucket ---"
if mc ls "target/$BUCKET" >/dev/null 2>&1; then
  objetos=$(mc ls --recursive "target/$BUCKET" 2>/dev/null | wc -l)
  echo "  ya existe, contiene $objetos objetos"
else
  mc mb "target/$BUCKET"
  echo "  creado"
fi

# Privado siempre: la aplicacion sirve los archivos por su propio endpoint
# autenticado. Un bucket publico dejaria las fotos de pacientes accesibles a
# cualquiera que adivine una URL.
mc anonymous set none "target/$BUCKET" >/dev/null
echo "  acceso anonimo: denegado"

echo "--- politica ---"
# `policy create` sobre una politica existente la reemplaza, asi que no hace
# falta borrarla antes. Se evita el borrado a proposito: entre el remove y el
# create la aplicacion recibia AccessDenied en cada subida y descarga.
mc admin policy create target "${APP_USER}-policy" /tmp/policy.json
echo "  ${APP_USER}-policy: solo lectura/escritura/borrado dentro de $BUCKET"

echo "--- usuario ---"
# El usuario no se borra nunca. `user add` sobre uno existente actualiza su
# secreto, que es justo lo que se quiere al rotar y lo que hay que evitar en
# el resto de los casos: por eso APP_SECRET llega vacio cuando no toca.
if [ -n "$APP_SECRET" ]; then
  mc admin user add target "$APP_USER" "$APP_SECRET"
  echo "  credencial escrita"
else
  echo "  ya existe, credencial intacta"
fi
# Adjuntar una politica ya adjunta devuelve error; es el estado deseado.
mc admin policy attach target "${APP_USER}-policy" --user "$APP_USER" 2>/dev/null || true
echo "  politica adjunta"
SCRIPT

if [ -z "$APP_SECRET" ]; then
  echo
  echo "Nada que actualizar en backend/.env: la credencial no cambio."
  echo "La comprobacion de permisos se omite porque MinIO no permite releer un"
  echo "secreto ya creado. Para verificarla, rotarla: scripts/minio-setup.sh --rotate-secret"
  exit 0
fi

echo
echo "Comprobando que la credencial nueva funciona y que NO puede mas de la cuenta..."
docker run --rm \
  -e MC_HOST_app="$SCHEME://$APP_USER:$APP_SECRET@$ENDPOINT" \
  --entrypoint sh minio/mc -c "
    mc ls app/$BUCKET >/dev/null 2>&1 && echo '  lee su bucket: OK' || echo '  lee su bucket: FALLA'
    mc ls app/ >/dev/null 2>&1 && echo '  lista otros buckets: SI (revisar politica)' || echo '  lista otros buckets: denegado, correcto'
    mc mb app/prueba-permisos >/dev/null 2>&1 && echo '  crea buckets: SI (revisar politica)' || echo '  crea buckets: denegado, correcto'
  "

echo
echo "Poner en backend/.env:"
echo
echo "  MINIO_ACCESS_KEY=$APP_USER"
echo "  MINIO_SECRET_KEY=$APP_SECRET"
echo
echo "Y recrear el backend, que lee el .env al arrancar:"
echo "  docker compose up -d --force-recreate backend"
