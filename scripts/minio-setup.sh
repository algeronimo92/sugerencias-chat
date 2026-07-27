#!/usr/bin/env bash
#
# Prepara MinIO para la aplicacion: bucket, politica de minimo privilegio y
# usuario de servicio.
#
# Se hace con script y no a mano en la consola para que sea repetible: si hay
# que rehacerlo -como acaba de pasar-, es un comando en vez de reconstruir de
# memoria que permisos llevaba.
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

# Secreto de 40 caracteres, como los que genera MinIO.
APP_SECRET="${MINIO_APP_SECRET:-$(head -c 30 /dev/urandom | base64 | tr -d '/+=' | head -c 40)}"

echo "Servidor : $URL"
echo "Bucket   : $BUCKET"
echo "Usuario  : $APP_USER"
echo

# La politica se genera aqui para que el nombre del bucket no quede duplicado
# en un archivo aparte que alguien olvidaria actualizar.
#
# Los permisos salen de lo que la aplicacion usa de verdad (ver
# services/media_storage.py):
#   bucket_exists -> ListBucket        put_object/fput_object -> PutObject
#   get_object    -> GetObject         remove_object          -> DeleteObject
#   stat_object   -> GetObject
# No hace falta crear ni borrar buckets, ni listar los demas.
POLICY=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": ["s3:GetBucketLocation", "s3:ListBucket"],
      "Resource": ["arn:aws:s3:::$BUCKET"]
    },
    {
      "Effect": "Allow",
      "Action": ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
      "Resource": ["arn:aws:s3:::$BUCKET/*"]
    }
  ]
}
JSON
)

docker run --rm -i \
  -e MC_HOST_target="$SCHEME://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@$ENDPOINT" \
  --entrypoint sh minio/mc -s <<SCRIPT
set -e

echo "$POLICY" > /tmp/policy.json

echo "--- bucket ---"
if mc ls target/$BUCKET >/dev/null 2>&1; then
  objetos=\$(mc ls --recursive target/$BUCKET 2>/dev/null | wc -l)
  echo "  ya existe, contiene \$objetos objetos"
else
  mc mb target/$BUCKET
  echo "  creado"
fi

# Privado siempre: la aplicacion sirve los archivos por su propio endpoint
# autenticado. Un bucket publico dejaria las fotos de pacientes accesibles a
# cualquiera que adivine una URL.
mc anonymous set none target/$BUCKET >/dev/null
echo "  acceso anonimo: denegado"

echo "--- politica ---"
mc admin policy create target ${APP_USER}-policy /tmp/policy.json 2>/dev/null \
  || mc admin policy remove target ${APP_USER}-policy >/dev/null 2>&1 \
  && mc admin policy create target ${APP_USER}-policy /tmp/policy.json
echo "  ${APP_USER}-policy: solo lectura/escritura/borrado dentro de $BUCKET"

echo "--- usuario ---"
mc admin user remove target "$APP_USER" >/dev/null 2>&1 || true
mc admin user add target "$APP_USER" "$APP_SECRET"
mc admin policy attach target ${APP_USER}-policy --user "$APP_USER"
echo "  creado y politica adjunta"
SCRIPT

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
