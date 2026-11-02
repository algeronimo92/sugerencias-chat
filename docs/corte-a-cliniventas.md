# Corte al `.env` de CliniVentas

Runbook para pasar producción de la instalación de un solo negocio a la que
define el `backend/.env` nuevo, que es el que manda:

| | Antes | Después |
|---|---|---|
| Base | `dermicapro_db`, rol `dermicapro` (superusuario) | `cliniventas_db`, rol `cliniventas` (sin privilegios) |
| Datos del negocio | schema `public` | schema del tenant DermicaPro |
| Multimedia | bucket `wsp`, prefijo `media/` | bucket `cliniventas`, `tenants/<carpeta del negocio>/` |
| Cifrado, sesiones, tokens de n8n | `SETTINGS_ENCRYPTION_KEY`, `SECRET_KEY`, webhooks | sin cambios: el `.env` nuevo conserva los valores |
| Modo | `MULTITENANCY_ENABLED=false` | `true`, panel en `admin.cliniventas.com` |

Nada de lo viejo se borra: `dermicapro_db` y el bucket `wsp` quedan como vuelta
atrás.

Todo se corre en el VPS, como root, desde `/root/sugerencias-chat`.

## Herramientas

| Paso | Herramienta |
|---|---|
| Copiar la base | `scripts/db-clone.sh` |
| Pasar `public` al tenant | `backend/scripts/move_public_to_tenant.py` |
| Re-cifrar secretos | `backend/scripts/rekey_settings.py` |
| Copiar multimedia | `backend/scripts/copy_legacy_media_to_tenant.py` |

Todas, salvo `db-clone.sh`, solo informan si no se les pasa `--apply`.

## 0. Preparación (sin corte, se puede hacer días antes)

**Las claves viejas viven solo en los contenedores `green`.** `docker inspect`
las lee aunque el contenedor esté parado, pero no si se borró, y un deploy
exitoso lo borra. Primero, guardar el `.env` viejo para poder volver atrás:

```bash
cd /root/sugerencias-chat/backend && umask 077 && docker inspect -f '{{range .Config.Env}}{{println .}}{{end}}' sugerencias-chat-green-backend-1 | grep -E '^(DATABASE_URL|DATABASE_SSL|SECRET_KEY|SETTINGS_ENCRYPTION_KEY|MEDIA_STORAGE_BACKEND|MINIO_[A-Z_]+|ADMIN_EMAIL|ADMIN_PASSWORD|INBOUND_WEBHOOK_TOKEN|OUTBOUND_WEBHOOK_TOKEN|VAPID_[A-Z_]+)=' > .env.viejo && chmod 600 .env.viejo && grep -c . .env.viejo
```

Debe imprimir `20`. Después, la rama con las herramientas en un worktree aparte
(el checkout principal lo maneja el deploy):

```bash
cd /root/sugerencias-chat && git fetch origin fix/corte-public-a-tenant && git worktree add /root/corte FETCH_HEAD
```

Y dos funciones para la sesión de shell. `viejo X` lee una variable del `.env`
viejo; `herramienta` corre un script de la rama con la imagen que está en
producción y el `.env` nuevo. Las variables con `-e NOMBRE` sin valor solo
pasan si se exportaron en el shell, así que ningún secreto queda en los
argumentos:

```bash
cd /root/sugerencias-chat
viejo() { sed -n "s/^$1=//p" backend/.env.viejo; }
herramienta() { docker run --rm --network dermicapro-data --env-file backend/.env -e OLD_SETTINGS_ENCRYPTION_KEY -e OLD_SECRET_KEY -e SOURCE_MINIO_ACCESS_KEY -e SOURCE_MINIO_SECRET_KEY -v /root/corte/backend/scripts:/app/scripts:ro sugerencias-chat-green-backend "$@"; }
```

### Adelantar la multimedia (~126 GB)

Opcional y recomendado. La copia definitiva es el paso 6, después del
deploy, pero hasta que termine los adjuntos viejos dan 404 en el CRM: con
multitenancy el backend solo los busca en el bucket nuevo. Adelantarla con la
app en marcha deja para el paso 6 solo lo que llegó entretanto.

Es seguro hacerlo antes: solo copia, no borra ni cambia nada de lo que usa
producción, y si el corte se cancela no hay nada que deshacer en `wsp`.

Las credenciales no se cruzan entre buckets, así que cada una lee o escribe
el suyo y los bytes pasan por el VPS, en streaming (no ocupan disco). Mientras
no haya corte, la base que sabe cuál es la carpeta del negocio es la vieja,
por eso esta pasada usa el `DATABASE_URL` viejo, con una función propia: lo
que va después de la imagen es el comando del contenedor, así que la opción
`-e DATABASE_URL` tiene que ir antes, dentro de la función. Son horas: correrlo
dentro de `tmux` (las funciones se definen de nuevo ahí) para que una caída
del SSH no lo corte; se reanuda solo, saltando lo ya copiado.

```bash
herramienta_bd_vieja() { docker run --rm --network dermicapro-data --env-file backend/.env -e DATABASE_URL -e SOURCE_MINIO_ACCESS_KEY -e SOURCE_MINIO_SECRET_KEY -v /root/corte/backend/scripts:/app/scripts:ro sugerencias-chat-green-backend "$@"; }
export DATABASE_URL="$(viejo DATABASE_URL)" SOURCE_MINIO_ACCESS_KEY="$(viejo MINIO_ACCESS_KEY)" SOURCE_MINIO_SECRET_KEY="$(viejo MINIO_SECRET_KEY)"
herramienta_bd_vieja python -m scripts.copy_legacy_media_to_tenant --hostname dermicapro.cliniventas.com --source-bucket wsp --source-prefix media --workers 8 --apply 2>&1 | tee /root/copia-media.log
unset DATABASE_URL SOURCE_MINIO_ACCESS_KEY SOURCE_MINIO_SECRET_KEY
```

### Ensayo de la base

Copia con la app en marcha, para ver que restaura y cuadra. Después se borra en
el paso 2 con `--replace`:

```bash
REPO_ROOT=/root/sugerencias-chat bash /root/corte/scripts/db-clone.sh --allow-live
```

## 1. Ventana de mantenimiento: parar escrituras

Desde acá el CRM no atiende. Backup y parar backend y worker (`stop`, no
`rm`: el contenedor guarda el entorno viejo para volver atrás):

```bash
scripts/db-backup.sh && docker stop sugerencias-chat-green-backend-1 sugerencias-chat-green-worker-1
docker ps -a --filter name=sugerencias-chat-blue -q | xargs -r docker stop
```

## 2. Copiar la base

```bash
REPO_ROOT=/root/sugerencias-chat bash /root/corte/scripts/db-clone.sh --replace
```

Termina con `Verificado: N tablas con el mismo número de filas`. Si dice
otra cosa, parar acá y volver atrás (paso 7).

## 3. Pasar `public` al tenant (en la base nueva)

```bash
herramienta python -m scripts.move_public_to_tenant --hostname dermicapro.cliniventas.com --discard-seeded-admin
herramienta python -m scripts.move_public_to_tenant --hostname dermicapro.cliniventas.com --discard-seeded-admin --apply
```

La primera pasada lista las tablas y las filas; `platform_users`,
`platform_sessions` y `organization_branding` no deben aparecer.

## 4. Comprobar el cifrado

El `.env` nuevo conserva `SETTINGS_ENCRYPTION_KEY` y `SECRET_KEY`, así que no
hay nada que re-cifrar. Esta pasada solo lo confirma con los datos ya en el
tenant: tiene que terminar en `Se re-cifrarían 0 valores`.

```bash
export OLD_SETTINGS_ENCRYPTION_KEY="$(viejo SETTINGS_ENCRYPTION_KEY)" OLD_SECRET_KEY="$(viejo SECRET_KEY)"
herramienta python -m scripts.rekey_settings
unset OLD_SETTINGS_ENCRYPTION_KEY OLD_SECRET_KEY
```

Si algún día cambia la clave, la misma herramienta con `--apply` re-cifra lo
que haga falta, y aborta sin escribir si algún valor no abre con ninguna clave.

## 5. Desplegar con el `.env` nuevo

```bash
./scripts/deploy-bluegreen.sh
```

Levanta el otro color con el `.env` nuevo, migra, comprueba salud y el camino
completo por Traefik, y recién entonces conmuta. Si falla, no conmuta: volver
atrás con el paso 7.

Comprobar: `https://dermicapro.cliniventas.com` muestra los leads y
`https://admin.cliniventas.com/platform` deja entrar (requiere el registro DNS
A de `admin`). Los adjuntos viejos solo abren si se adelantó la copia; si no,
abren a medida que avanza el paso 6.

## 6. Copiar la multimedia

Una vez que el paso 5 quedó bien. Ya con la base nueva, así que sin el
`DATABASE_URL` viejo. Si se adelantó la copia, solo pasa lo que llegó desde
entonces; si no, los ~126 GB, en `tmux`:

```bash
export SOURCE_MINIO_ACCESS_KEY="$(viejo MINIO_ACCESS_KEY)" SOURCE_MINIO_SECRET_KEY="$(viejo MINIO_SECRET_KEY)"
herramienta python -m scripts.copy_legacy_media_to_tenant --hostname dermicapro.cliniventas.com --source-bucket wsp --source-prefix media --workers 8 --apply
unset SOURCE_MINIO_ACCESS_KEY SOURCE_MINIO_SECRET_KEY
```

Termina con un resumen en JSON. `errores` y `conflictos` tienen que ser 0; si
no, lista los primeros 20 y se puede volver a correr: retoma donde quedó.

Después:

- `monitoring/.env`: `POSTGRES_EXPORTER_DSN` a `cliniventas_db`.
- `git worktree remove /root/corte`.
- El bucket `wsp` y `dermicapro_db` se quedan hasta estar seguros de no
  necesitar la vuelta atrás.

## 7. Vuelta atrás

Antes del paso 5: nada se tocó del lado viejo. Volver a arrancar el color que
servía:

```bash
docker start sugerencias-chat-green-backend-1 sugerencias-chat-green-worker-1
```

Después del paso 5: restaurar el `.env` viejo y desplegar con él. Apunta otra
vez a `dermicapro_db` y a `wsp`, que siguen intactos:

```bash
cp -p backend/.env backend/.env.cliniventas && cp -p backend/.env.viejo backend/.env && ./scripts/deploy-bluegreen.sh
```

Lo escrito en la instalación nueva entre el corte y la vuelta atrás no vuelve
solo: queda en `cliniventas_db`.
