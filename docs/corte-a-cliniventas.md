# Corte al `.env` de CliniVentas

Runbook para pasar producción de la instalación de un solo negocio a la que
define el `backend/.env` nuevo, que es el que manda:

| | Antes | Después |
|---|---|---|
| Base | `dermicapro_db`, rol `dermicapro` (superusuario) | `cliniventas_db`, rol `cliniventas` (sin privilegios) |
| Datos del negocio | schema `public` | schema del tenant DermicaPro |
| Multimedia | bucket `wsp`, prefijo `media/` | bucket `cliniventas`, `tenants/<carpeta del negocio>/` |
| Cifrado | `SETTINGS_ENCRYPTION_KEY` / `SECRET_KEY` viejas | las del `.env` nuevo |
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

Se puede correr con la app en marcha, todas las veces que haga falta: copia lo
que falta y se salta lo que ya está. Mientras no haya corte, la base que sabe
cuál es la carpeta del negocio es la vieja, por eso esta pasada usa el
`DATABASE_URL` viejo.

**Variante A (recomendada):** dar a la credencial nueva permiso de lectura
sobre `wsp` en la consola de MinIO. La copia la hace MinIO por dentro.

```bash
export DATABASE_URL="$(viejo DATABASE_URL)"
herramienta -e DATABASE_URL python -m scripts.copy_legacy_media_to_tenant --hostname dermicapro.cliniventas.com --source-bucket wsp --source-prefix media --workers 8 --apply
unset DATABASE_URL
```

**Variante B:** sin tocar permisos, cada credencial con su bucket. Los bytes
pasan por el VPS.

```bash
export DATABASE_URL="$(viejo DATABASE_URL)" SOURCE_MINIO_ACCESS_KEY="$(viejo MINIO_ACCESS_KEY)" SOURCE_MINIO_SECRET_KEY="$(viejo MINIO_SECRET_KEY)"
herramienta -e DATABASE_URL python -m scripts.copy_legacy_media_to_tenant --hostname dermicapro.cliniventas.com --source-bucket wsp --source-prefix media --workers 8 --apply
unset DATABASE_URL SOURCE_MINIO_ACCESS_KEY SOURCE_MINIO_SECRET_KEY
```

### Ensayo de la base

Copia con la app en marcha, para ver que restaura y cuadra. Después se borra en
el paso 3 con `--replace`:

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

## 4. Re-cifrar los secretos

```bash
export OLD_SETTINGS_ENCRYPTION_KEY="$(viejo SETTINGS_ENCRYPTION_KEY)" OLD_SECRET_KEY="$(viejo SECRET_KEY)"
herramienta python -m scripts.rekey_settings
herramienta python -m scripts.rekey_settings --apply
unset OLD_SETTINGS_ENCRYPTION_KEY OLD_SECRET_KEY
```

Hoy son 5 valores: 4 en `app_settings` y 1 en `platform_settings`. Si alguno no
abre con ninguna clave, aborta sin escribir.

## 5. Última pasada de multimedia

Igual que en la preparación, pero ya con la base nueva (sin el
`DATABASE_URL` viejo). Debe copiar solo lo que llegó desde la pasada anterior:

```bash
export SOURCE_MINIO_ACCESS_KEY="$(viejo MINIO_ACCESS_KEY)" SOURCE_MINIO_SECRET_KEY="$(viejo MINIO_SECRET_KEY)"   # solo variante B
herramienta python -m scripts.copy_legacy_media_to_tenant --hostname dermicapro.cliniventas.com --source-bucket wsp --source-prefix media --workers 8 --apply
unset SOURCE_MINIO_ACCESS_KEY SOURCE_MINIO_SECRET_KEY
```

## 6. Desplegar con el `.env` nuevo

```bash
./scripts/deploy-bluegreen.sh
```

Levanta el otro color con el `.env` nuevo, migra, comprueba salud y el camino
completo por Traefik, y recién entonces conmuta. Si falla, no conmuta: volver
atrás con el paso 7.

Comprobar: `https://dermicapro.cliniventas.com` muestra los leads,
los adjuntos viejos abren y `https://admin.cliniventas.com/platform` deja
entrar (requiere el registro DNS A de `admin`).

Después:

- `monitoring/.env`: `POSTGRES_EXPORTER_DSN` a `cliniventas_db`.
- n8n: los tokens `INBOUND_WEBHOOK_TOKEN` / `OUTBOUND_WEBHOOK_TOKEN` nuevos.
- Los usuarios vuelven a iniciar sesión (cambió `SECRET_KEY`).
- `git worktree remove /root/corte`.

## 7. Vuelta atrás

Antes del paso 6: nada se tocó del lado viejo. Volver a arrancar el color que
servía:

```bash
docker start sugerencias-chat-green-backend-1 sugerencias-chat-green-worker-1
```

Después del paso 6: restaurar el `.env` viejo y desplegar con él. Apunta otra
vez a `dermicapro_db` y a `wsp`, que siguen intactos:

```bash
cp -p backend/.env backend/.env.cliniventas && cp -p backend/.env.viejo backend/.env && ./scripts/deploy-bluegreen.sh
```

Lo escrito en la instalación nueva entre el corte y la vuelta atrás no vuelve
solo: queda en `cliniventas_db`.
