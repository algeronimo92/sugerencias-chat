# 06 - Revisión de consistencia en ficheros de configuración

Alcance: auditoría cruzada de todos los ficheros de configuración del repo
(composes, Traefik, variables de entorno, Dockerfiles, tooling de frontend,
Alembic, pytest, GitHub Actions, .gitignore/.gitattributes) buscando
incoherencias reales y verificadas entre ellos.

Solo se listan incoherencias comprobadas leyendo los ficheros. No se incluyen
sospechas ni recomendaciones de estilo sin impacto.

Leyenda de severidad:

- **Crítica**: fuga de secretos, rotura de despliegue o de seguridad en producción.
- **Alta**: fallo funcional probable en algún entorno, pérdida de datos o superficie de ataque abierta.
- **Media**: incoherencia real con impacto acotado o riesgo latente.
- **Baja**: ruido, deuda de configuración, documentación desalineada.

---

## 1. Inventario de ficheros auditados

| Área | Ficheros |
| --- | --- |
| Orquestación | `compose.yml`, `compose.prod.yml`, `compose.bluegreen.yml`, `compose.db.yml` |
| Proxy | `traefik/reverse-proxy.docker-compose.yml`, `traefik/docker-compose.yml`, `traefik/dynamic/active.yml`, `traefik/.env.example` |
| Entorno | `backend/.env.example`, `backend/config.py`, `db/.env.example`, `frontend/.env.example` |
| Imágenes | `backend/Dockerfile`, `backend/.dockerignore`, `frontend/Dockerfile`, `frontend/.dockerignore`, `frontend/nginx.conf` |
| Frontend tooling | `frontend/package.json`, `frontend/vite.config.ts`, `frontend/tsconfig*.json`, `frontend/.oxlintrc.json`, `frontend/.storybook/*` |
| Backend tooling | `backend/alembic.ini`, `backend/alembic/env.py`, `backend/pytest.ini`, `backend/requirements*.txt` |
| CI/CD | `.github/workflows/ci-cd.yml`, `.github/workflows/react-doctor.yml`, `scripts/deploy-bluegreen.sh`, `scripts/db-backup.sh`, `scripts/gen-db-tls.sh`, `scripts/minio-setup.sh` |
| Base de datos | `db/pg_hba.conf` |
| Versionado | `.gitignore`, `backend/.gitignore`, `frontend/.gitignore`, `.gitattributes` |

Verificación previa importante: **`backend/.env` NO está commiteado**. `git ls-files`
solo devuelve `backend/.env.example`. Lo mismo para `db/.env`, `traefik/.env` y
`frontend/.env`. No hay fuga de secretos por esa vía.

---

## 2. Docker Compose

| Sev. | Ficheros implicados | Incoherencia | Impacto real | Corrección propuesta |
| --- | --- | --- | --- | --- |
| Alta | `compose.prod.yml` (sin volumen para media), `backend/.env.example:75`, `backend/services/media_storage.py:26-27`, `backend/.dockerignore:13` | `MEDIA_STORAGE_BACKEND=local` es el valor que se entrega en el ejemplo, y con él el multimedia se escribe en `/app/media` **dentro** del contenedor. `compose.prod.yml` no monta ningún volumen para esa ruta, y `.dockerignore` excluye `media/` de la imagen. | En blue-green cada despliegue crea contenedores nuevos (`scripts/deploy-bluegreen.sh:125`) y luego apaga el color anterior (`:154`): todo lo subido con backend `local` se pierde en el siguiente deploy. | O bien fijar `MEDIA_STORAGE_BACKEND=minio` como valor entregado en `.env.example`, o bien montar un volumen nombrado en `compose.prod.yml` (`- media:/app/media`) compartido por ambos colores. |
| Alta | `compose.yml:11-12`, `backend/.env.example:11-19`, `README.md:187-192` | El compose de *desarrollo* usa `env_file: ./backend/.env`, y el flujo documentado en ese mismo `.env.example` y en el README es que `DATABASE_URL` apunte a la base de **producción**. No existe compose ni `.env` de desarrollo con base propia. | Cualquier prueba local escribe sobre datos reales de pacientes. Está avisado en comentarios, pero es el camino por defecto, no la excepción. | Añadir un servicio `postgres` opcional a `compose.yml` (o un `compose.dev-db.yml`) y dejar la base de producción como override consciente. |
| Media | `compose.db.yml:17-19` y `:73-74` y `:87-88`, `db/.env.example:15`, `README.md:47` | Los tres comentarios afirman que la base "NO expone ningún puerto al host" / "sin definir, PostgreSQL solo escucha en localhost y en la red de Docker". La línea real `- "${POSTGRES_BIND_IP:-127.0.0.1}:${POSTGRES_PUBLISH_PORT:-5432}:5432"` **siempre publica**, por defecto en `127.0.0.1:5432`. | La afirmación del README es falsa. Colisiona con cualquier PostgreSQL instalado en el host y amplía la superficie local sin que nadie lo haya pedido. | Corregir la redacción, o hacer la publicación condicional (perfil de compose) para que "sin definir" signifique de verdad "sin publicar". |
| Media | `compose.prod.yml:19-20` y `:29-30` frente a `compose.bluegreen.yml:19,22-26` y `traefik/docker-compose.yml:3,12` | El fichero base publica `backend 8000:8000` y `frontend 80:80` en todas las interfaces. La postura de seguridad declarada (`compose.bluegreen.yml:17-18`, `README.md:175`) es la contraria, y solo se consigue porque **los dos** overrides anulan esos puertos. | `docker compose -f compose.prod.yml up -d` a secas deja la API FastAPI abierta a Internet sin TLS y sin nginx delante. Es un pie de foto que solo funciona si nadie olvida el `-f` del override. | Quitar `ports` de `compose.prod.yml` y publicarlos solo en el override que lo necesite (o dejar el base atado a `127.0.0.1`). |
| Baja | `compose.bluegreen.yml:13`, `traefik/dynamic/active.yml:6`, `.github/workflows/ci-cd.yml:142` | Rutas de script equivocadas en comentarios: dicen `backend/scripts/deploy-bluegreen.sh` cuando el fichero real es `scripts/deploy-bluegreen.sh` (raíz), y `scripts/migrate.py` cuando es `backend/scripts/migrate.py`. | Confunde en una urgencia, que es justo cuando se leen esos comentarios. | Corregir las tres rutas. |

Coherencias verificadas (sin hallazgo): la red `dermicapro-data` la crea
`compose.db.yml:104-106` y la consume `compose.prod.yml:34-40` como `external`
con el mismo nombre; el volumen `dermicapro-pgdata` está nombrado
explícitamente (`compose.db.yml:97-102`); el alias de red `postgres`
(`compose.db.yml:89-92`) coincide con el host de `backend/.env.example:11`; y
`ci-cd.yml:98` levanta la base con el mismo `--env-file db/.env` que
`scripts/db-backup.sh:23`.

---

## 3. Traefik

| Sev. | Ficheros implicados | Incoherencia | Impacto real | Corrección propuesta |
| --- | --- | --- | --- | --- |
| Media | `traefik/reverse-proxy.docker-compose.yml:26,30-31`, `traefik/.env.example:2`, comparado con `compose.db.yml:31-33` | `--certificatesresolvers.letsencrypt.acme.email=${ACME_EMAIL}` se interpola **sin** `:?`. El resto del repo sí usa la forma que falla ruidosamente (`${POSTGRES_DB:?falta POSTGRES_DB}`, `${COLOR_PORT:?...}`). | Sin `traefik/.env`, Traefik arranca con el email vacío y Let's Encrypt rechaza el registro ACME: el sitio queda sin certificado y el error aparece en los logs de Traefik, no en el despliegue. | `${ACME_EMAIL:?define ACME_EMAIL en traefik/.env}`. |
| Media | `traefik/dynamic/active.yml:33-36`, `frontend/nginx.conf:79-83`, `compose.prod.yml:13-18` | El `healthCheck` de Traefik apunta a `path: /`, que nginx resuelve con `try_files $uri $uri/ /index.html` y devuelve 200 siempre. El healthcheck real de la aplicación (`/health/ready`, que sí comprueba DB y almacenamiento) solo se usa en el healthcheck de Docker y en el script de deploy. | Si el backend cae *después* de conmutar, Traefik sigue considerando sano el color: sirve la SPA y todas las llamadas de API fallan. El health check no aporta nada. | Apuntar el `healthCheck` de Traefik a una ruta que atraviese nginx hasta el backend (`/api/...` o exponer `/health` a través de nginx). |
| Baja | `traefik/docker-compose.yml:6`, `traefik/dynamic/active.yml:18`, `scripts/deploy-bluegreen.sh:29` | El dominio `chat.dermicapro.app` está repetido en tres ficheros. Solo el script lo permite sobreescribir (`DEPLOY_DOMAIN`); los otros dos están fijos y esa variable no aparece en ningún `.env.example`. | Cambiar de dominio exige tocar tres ficheros y es fácil dejar uno atrás; con `active.yml` desalineado el despliegue conmuta a un router que nadie enruta. | Documentar `DEPLOY_DOMAIN` y, como mínimo, referenciar en el README los tres puntos que hay que cambiar juntos. |

Coherencias verificadas: los dos modos de enrutado (etiquetas Docker vs
proveedor de archivo) están explícitamente documentados como excluyentes
(`compose.bluegreen.yml:1-3`, `README.md:167`) y `compose.bluegreen.yml:29-30`
desactiva `traefik.enable` en los colores, cosa que además está cubierta por un
test (`backend/tests/test_bluegreen_config.py:111-117`). Los puertos de color
(blue 8081 / green 8082) coinciden en `compose.bluegreen.yml:26` (vía
`COLOR_PORT`), `traefik/dynamic/active.yml:32`, `scripts/deploy-bluegreen.sh:33`
y `backend/tests/test_bluegreen_config.py:21`.

---

## 4. Variables de entorno

### 4.1 Hallazgos

| Sev. | Ficheros implicados | Incoherencia | Impacto real | Corrección propuesta |
| --- | --- | --- | --- | --- |
| Alta | `backend/.env.example:27-29`, `backend/services/auth_service.py:113-115`, `backend/main.py:274-275` | `INBOUND_WEBHOOK_TOKEN` se entrega vacío y `verify_webhook_token` hace `return` sin comprobar nada cuando el valor es vacío. Ese `Depends` es lo único que protege `webhooks.router` y `media.router` (subida de archivos). | Con la configuración de ejemplo, `POST /api/webhooks/*` y la subida de multimedia quedan **abiertos sin autenticación** a cualquiera que alcance el backend. El comentario lo describe como una opción ("dejar vacío para no exigir autenticación"), no como lo que es. | Hacerlo obligatorio en producción: sin token, rechazar (503/401) en lugar de dejar pasar; o al menos exigirlo en el chequeo previo de `ci-cd.yml` igual que se hace con `DATABASE_SSL`. |
| Media | `backend/config.py:46`, `backend/main.py:248-253`, `backend/.env.example:31-32`, `compose.prod.yml` | El default de `cors_origins` es `["http://localhost:5173", "http://localhost:3000"]` y `allow_credentials=True`. En producción `CORS_ORIGINS` no se define en ningún sitio (la línea de `.env.example` está comentada y `compose.prod.yml` no la pone). | La API de producción acepta peticiones con credenciales desde orígenes `localhost`. No es explotable en remoto, pero es un default que no corresponde a producción y que nadie ha decidido conscientemente. | Dejar `cors_origins` vacío por defecto y definirlo explícitamente por entorno; en producción con nginx same-origin no hace falta ninguno. |
| Media | `backend/.env.example:31` vs `backend/config.py:46` | La documentación dice "separados por coma en lista Python"; el tipo declarado es `list[str]`, que pydantic-settings parsea como **JSON**. El ejemplo de la línea 32 sí es JSON, así que la frase contradice a su propio ejemplo. | Quien siga la frase y escriba `CORS_ORIGINS=a,b` revienta el arranque del backend con un error de parseo, no con un fallo de CORS. | Reescribir el comentario: "lista JSON". |
| Media | `backend/config.py:9-19`, `compose.db.yml:44-48`, `db/pg_hba.conf:32-37`, `.github/workflows/ci-cd.yml:130-135` | `database_ssl` sigue con default `"prefer"` y un comentario extenso que afirma que el servidor "tiene ssl=off" y que exigir `require` "dejaría el backend sin arrancar". Eso ya no es cierto: `compose.db.yml` arranca con `ssl=on` sin interruptor y `pg_hba.conf` rechaza toda conexión sin cifrar; el propio pipeline **aborta** si `backend/.env` no tiene `DATABASE_SSL=require`. | El default entregado es el inseguro y el comentario describe un mundo que ya no existe, lo que induce a "arreglar" el .env en la dirección equivocada. Solo el chequeo del pipeline evita el problema. | Subir el default a `require` y reescribir el comentario. |
| Media | `backend/config.py:23-26,42,45,72-73` vs `backend/.env.example` | Ocho variables reales de configuración no aparecen en el ejemplo: `DATABASE_POOL_PRE_PING`, `DATABASE_POOL_SIZE`, `DATABASE_MAX_OVERFLOW`, `DATABASE_POOL_RECYCLE_SECONDS`, `ACCESS_TOKEN_EXPIRE_HOURS`, `AUTH_USER_CACHE_TTL_SECONDS`, `DEFAULT_COUNTRY_CODE`, `AUTO_ASSIGN_LEADS_ENABLED`. | Ajustes de pool y de sesión invisibles: para tocarlos hay que leer `config.py`. `DEFAULT_COUNTRY_CODE` y `AUTO_ASSIGN_LEADS_ENABLED` además son editables desde la UI, así que su valor de arranque es semi-oculto. | Documentarlas comentadas en `.env.example` con su default. |
| Baja | `backend/config.py:36-39,45`, `backend/services/tts_service.py:51-54` | Tipos declarados como `str` para valores que son `float` (`elevenlabs_stability/style/speed`) y `bool` (`elevenlabs_use_speaker_boost`, `auto_assign_leads_enabled`). La conversión ocurre tarde, en el momento de la petición. | Un valor no numérico (por `.env` o por `app_settings`) no se detecta al arrancar sino con un `ValueError` en pleno envío de audio. Es deliberado (`app_settings` guarda cadenas) pero deja el fallo sin validación temprana. | Validar en `tts_service` con un fallback al default en vez de dejar que `float()` propague. |
| Baja | `.github/workflows/ci-cd.yml:45-46` vs `backend/config.py:5,27,67` | El comentario dice "esas **dos** variables son obligatorias", pero el paso define tres. Solo `DATABASE_URL` y `SECRET_KEY` carecen de default; `n8n_webhook_url` tiene `""`. | Ruido. Se arrastra una variable que no hace falta en CI. | Ajustar el comentario o quitar `N8N_WEBHOOK_URL` de los dos pasos. |
| Baja | `backend/config.py:46` vs `compose.yml:14,35`, `README.md:187` | El default de `cors_origins` no incluye `http://localhost:5174`, que es el puerto de desarrollo documentado. Solo funciona porque `compose.yml:14` lo inyecta. | Levantar el backend fuera de compose (uvicorn local) con el frontend en Docker rompe con error de CORS sin razón aparente. | Añadir `http://localhost:5174` al default. |
| Baja | `scripts/deploy-bluegreen.sh:29-31`, `scripts/minio-setup.sh:33-36` | `DEPLOY_DOMAIN`, `HEALTH_ATTEMPTS`, `HEALTH_INTERVAL`, `MINIO_APP_USER` son variables reales de operación y no están en ningún `.env.example`. | Palancas de despliegue que solo se descubren leyendo el script. | Documentarlas en el README o en un `.env.example` de despliegue. |

### 4.2 Tabla comparativa de variables

Leyenda: `-` no aparece; `(com.)` presente pero comentada.

| Variable | Usada en código | En `.env.example` | En composes | En CI | Veredicto |
| --- | --- | --- | --- | --- | --- |
| `DATABASE_URL` | `config.py:5`, `scripts/db_latency.py:47` | `backend:11` | `env_file` | `ci-cd.yml:41,50` | OK |
| `DATABASE_SSL` | `config.py:19`, `db_latency.py:73` | `backend:12` | `env_file` | validada en `ci-cd.yml:130` | Default `prefer` obsoleto e inseguro |
| `DATABASE_POOL_PRE_PING` | `config.py:23` | - | - | - | Falta documentar |
| `DATABASE_POOL_SIZE` | `config.py:24` | - | - | - | Falta documentar |
| `DATABASE_MAX_OVERFLOW` | `config.py:25` | - | - | - | Falta documentar |
| `DATABASE_POOL_RECYCLE_SECONDS` | `config.py:26` | - | - | - | Falta documentar |
| `N8N_WEBHOOK_URL` | `config.py:27` vía `settings_service.py:34` | `backend:22` | `env_file` | `ci-cd.yml:42,51` | OK (no obligatoria, pese al comentario de CI) |
| `N8N_WEBHOOK_TOKEN` | `settings_service.py:35` | `backend:25` | `env_file` | - | OK |
| `INBOUND_WEBHOOK_TOKEN` | `auth_service.py:113` | `backend:29` (vacío) | `env_file` | - | **Default abre los webhooks sin auth** |
| `EVOLUTION_API_URL/KEY/INSTANCE` | `settings_service.py:43-45` | `backend:36-38` | `env_file` | - | OK |
| `ELEVENLABS_API_KEY` | `settings_service.py:46` | `backend:44` | `env_file` | - | OK |
| `ELEVENLABS_VOICE_ID/MODEL_ID/STABILITY/STYLE/SPEED/USE_SPEAKER_BOOST` | `config.py:34-39`, `tts_service.py:51-54` | `backend:45-50` (com.) | - | - | OK; tipos declarados como `str` |
| `DEFAULT_COUNTRY_CODE` | `config.py:42`, `settings_service.py:59` | - | - | - | Falta documentar |
| `AUTO_ASSIGN_LEADS_ENABLED` | `config.py:45`, `settings_service.py:60-67` | - | - | - | Falta documentar |
| `CORS_ORIGINS` | `config.py:46`, `main.py:250` | `backend:31-32` (com.) | `compose.yml:14` | - | Doc contradice al tipo; default peligroso en prod |
| `MEDIA_STORAGE_BACKEND` | `config.py:50`, `media_storage.py:53` | `backend:75` (`local`) | - | - | Default sin volumen: pérdida de datos |
| `MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET/REGION/SECURE/VERIFY_TLS/PREFIX` | `config.py:51-58` | `backend:76-85` | - | - | OK |
| `COOKIE_SECURE` | `config.py:64` | `backend:58` (com.) | - | - | OK |
| `SECRET_KEY` | `config.py:67` | `backend:53` | `env_file` | `ci-cd.yml:43,52` | OK |
| `SETTINGS_ENCRYPTION_KEY` | `config.py:71`, `secret_cipher.py` | `backend:64` | `env_file` | - | OK (deriva de `SECRET_KEY` si falta) |
| `ACCESS_TOKEN_EXPIRE_HOURS` | `config.py:72` | - | - | - | Falta documentar |
| `AUTH_USER_CACHE_TTL_SECONDS` | `config.py:73` | - | - | - | Falta documentar |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `config.py:77-78`, `db_service.seed_admin_if_needed` | `backend:69-70` | `env_file` | - | OK |
| `POSTGRES_DB/USER/PASSWORD` | `compose.db.yml:31-33`, `db-backup.sh:34-35` | `db:4-6` | `compose.db.yml` | - | OK (obligatorias con `:?`) |
| `POSTGRES_BIND_IP` / `POSTGRES_PUBLISH_PORT` | `compose.db.yml:88` | `db:18-19` (com.) | `compose.db.yml` | - | La doc dice "no publica"; siempre publica |
| `BACKUP_KEEP_DAYS` | `scripts/db-backup.sh:25` | `db:9` (com.) | - | - | OK |
| `ACME_EMAIL` | `traefik/reverse-proxy...:26` | `traefik:2` | `traefik/...` | - | Sin `:?`: falla en silencio |
| `COLOR_PORT` | `compose.bluegreen.yml:26` | - | `compose.bluegreen.yml` | - | OK, lo inyecta `deploy-bluegreen.sh:43` |
| `DEPLOY_DOMAIN` / `HEALTH_ATTEMPTS` / `HEALTH_INTERVAL` | `deploy-bluegreen.sh:29-31` | - | - | - | Sin documentar |
| `ALEMBIC_BASELINE` | `alembic/env.py:66,74` | - | - | - | OK (interna, de un solo uso) |
| `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` / `MINIO_APP_USER` | `scripts/minio-setup.sh` | - | - | - | Solo script; documentadas en su cabecera |
| `VITE_API_BASE_URL` | `api/client.ts:5`, `useChats.ts:97`, `utils/message.ts:433` | `frontend:2` | `compose.yml:33`, `compose.prod.yml:27` | `ci-cd.yml:62` | OK |

---

## 5. Dockerfiles y .dockerignore

| Sev. | Ficheros implicados | Incoherencia | Impacto real | Corrección propuesta |
| --- | --- | --- | --- | --- |
| Baja | `frontend/Dockerfile:8` vs `:15` | La etapa `dev` usa `npm install` y la etapa `build` usa `npm ci`. | El contenedor de desarrollo puede resolver versiones distintas de las del lockfile con el que se construye producción: bugs que solo aparecen en uno de los dos. | Usar `npm ci` también en `dev`. |
| Baja | `frontend/.dockerignore` (5 líneas) vs `frontend/.gitignore` | El `.dockerignore` no excluye `storybook-static`, `coverage` ni `.storybook`, que sí están contemplados como artefactos en el `.gitignore`. | Contexto de build más pesado de lo necesario; `storybook-static` local entra en la etapa `build`. | Alinear ambos ficheros. |
| Baja | `backend/.dockerignore:14` vs `git ls-files` | `media-migration-report.json` está excluido de la imagen por ser un artefacto, pero está **commiteado** en el repo (46 KB). Ver también sección 9. | Incoherencia declarada: el mismo fichero se trata como artefacto en Docker y como fuente en git. | Borrarlo del repo y añadirlo a `.gitignore`. |
| Baja | `backend/Dockerfile` (completo) | La imagen no fija `TZ` ni usuario no-root, mientras el dominio sí tiene zona horaria propia (ver sección 12) y el resto de la configuración es cuidadosa con privilegios (`pg_hba.conf`, usuario MinIO de mínimo privilegio). | Los contenedores corren en UTC y como root. Funcional, pero desalineado con el criterio del resto del repo. | Añadir `ENV TZ=America/Lima` y un usuario de aplicación. |

Coherencias verificadas: `EXPOSE 8000` (`backend/Dockerfile:16`) coincide con el
`CMD` de uvicorn (`:18`), con los healthchecks (`compose.yml:19`,
`compose.prod.yml:14`), con `proxy_pass http://backend:8000`
(`frontend/nginx.conf:22,37,45`) y con el chequeo de `deploy-bluegreen.sh:74`.
El `ARG VITE_API_BASE_URL` (`frontend/Dockerfile:17-18`) recibe el `""` de
`compose.prod.yml:27` y de `ci-cd.yml:62`, y los tres consumidores del frontend
usan `?? 'http://localhost:8000'`, que **no** sustituye la cadena vacía: en
producción las rutas quedan relativas, como se espera.

---

## 6. Tooling de frontend (vite, tsconfig, oxlint, storybook)

| Sev. | Ficheros implicados | Incoherencia | Impacto real | Corrección propuesta |
| --- | --- | --- | --- | --- |
| Media | `frontend/tsconfig.app.json:25`, `frontend/tsconfig.node.json:22`, `frontend/.storybook/main.ts`, `frontend/.storybook/preview.tsx` | Los ficheros de Storybook no están en el `include` de ningún proyecto de TypeScript (`["src"]` y `["vite.config.ts"]` respectivamente). | `npm run build` (`tsc -b`) nunca comprueba tipos ahí, y CI tampoco: un error solo aparece al ejecutar Storybook a mano. | Añadir `.storybook` al `include` de `tsconfig.node.json`. |
| Baja | `frontend/package.json:10`, `.github/workflows/ci-cd.yml:22-25` | El script `build-storybook` no se ejecuta en ningún workflow. `frontend-checks` corre lint, test y build, pero no toca Storybook. | Storybook se puede romper sin que nadie se entere hasta el siguiente intento manual. | Añadir el paso, o asumir explícitamente que Storybook no es parte del pipeline. |

Coherencias verificadas: `vite.config.ts:44` excluye `*.stories.tsx` del
`include` de vitest, lo que evita que Storybook contamine `npm test`; el
`navigateFallbackDenylist` del service worker (`vite.config.ts:29`:
`/^\/api\//, /^\/media\//, /^\/ws\//`) cubre exactamente las tres rutas que
`frontend/nginx.conf` proxea al backend (`:21`, `:36`, `:44`); y las rutas de
no-caché de nginx (`/sw.js`, `/registerSW.js`, `/manifest.webmanifest`,
`nginx.conf:61-74`) coinciden con lo que genera `vite-plugin-pwa` con
`manifest: false` más el `public/manifest.webmanifest` enlazado desde
`index.html:7`. El `theme_color` del manifest (`#008069`) coincide con el
`<meta name="theme-color">` de `index.html:21`.

---

## 7. Alembic y pytest frente a la estructura real

| Sev. | Ficheros implicados | Incoherencia | Impacto real | Corrección propuesta |
| --- | --- | --- | --- | --- |
| Media | `backend/tests/test_bluegreen_config.py:15`, `backend/requirements.txt`, `backend/requirements-dev.txt` | El test importa `yaml` (PyYAML) a nivel de módulo y PyYAML **no está declarado** en ninguno de los dos ficheros de requisitos. Hoy llega de rebote como extra de `uvicorn[standard]` (`requirements.txt:2`). | La suite entera falla en colección si uvicorn cambia sus extras o si alguien instala solo `requirements-dev.txt` con otro servidor. Dependencia implícita y silenciosa. | Añadir `PyYAML==...` a `requirements-dev.txt`. |
| Baja | `backend/alembic.ini:15-16` | Se declaran a la vez `path_separator = os` y `version_path_separator = os`; el segundo es la clave antigua que el primero sustituye. | Redundancia; en versiones futuras de Alembic puede provocar un aviso o un conflicto. | Dejar solo `path_separator`. |

Coherencias verificadas: `script_location = alembic` y `prepend_sys_path = .`
(`alembic.ini:13-14`) coinciden con la estructura real (`backend/alembic/env.py`
+ `backend/alembic/versions/` con 12 revisiones). `env.py` toma la URL de
`config.settings` en vez de `alembic.ini`, tal y como documenta
`alembic.ini:8-10`. `pytest.ini` (`testpaths = tests`, `pythonpath = .`) solo
funciona ejecutando desde `backend/`, que es exactamente lo que hace
`ci-cd.yml:29-31`. `asyncio_mode = auto` (`pytest.ini:4`) tiene su plugin
declarado en `requirements-dev.txt:10` con el motivo explicado.

---

## 8. GitHub Actions

| Sev. | Ficheros implicados | Incoherencia | Impacto real | Corrección propuesta |
| --- | --- | --- | --- | --- |
| Baja | `.github/workflows/react-doctor.yml:33` vs `.github/workflows/ci-cd.yml:16,33,58` | `actions/checkout@v5` en un workflow y `@v4` en los tres jobs del otro. | Comportamiento y parcheo divergentes entre workflows del mismo repo. | Unificar la versión. |
| Baja | `.github/workflows/ci-cd.yml:83-85` | El job `deploy` no declara `concurrency`. `react-doctor.yml:24-26` sí lo hace. | Dos pushes seguidos a `main` pueden lanzar dos `deploy-bluegreen.sh` concurrentes sobre el mismo servidor, reescribiendo `active.yml` a la vez. La reescritura es atómica (`deploy-bluegreen.sh:65`) pero el resto del proceso no. | Añadir `concurrency: { group: deploy, cancel-in-progress: false }` al job. |

**Versiones: sin desalineación.** Node 22 en `frontend/Dockerfile:2` y en
`ci-cd.yml:19`; Python 3.12 en `backend/Dockerfile:1`, `ci-cd.yml:36` y en la
imagen auxiliar de `ci-cd.yml:72`. `cache-dependency-path` apunta al
`frontend/package-lock.json` real. `npm ci` en CI (`ci-cd.yml:22`) coincide con
la etapa `build` del Dockerfile. Ninguna versión de `package.json` exige un Node
distinto del 22 (`package.json` no declara `engines`).

---

## 9. .gitignore, .gitattributes y artefactos commiteados

| Sev. | Ficheros implicados | Incoherencia | Impacto real | Corrección propuesta |
| --- | --- | --- | --- | --- |
| Media | `.gitignore:14-18`, ficheros sin rastrear en la raíz | Los exports de n8n `automatic - notificaciones automaticas citas.json` y `evolution-enviar mensaje.json` están en la raíz **sin rastrear y sin ignorar** (`git check-ignore` no los captura; solo se ignoran `/rag.json`, `docs/rag.json` y `docs/rag-v2.json`). El propio comentario del `.gitignore` dice que los exports de n8n llevan la API key de Evolution y los tokens de webhook embebidos y "JAMÁS deben subirse al repo". | Un `git add .` los commitea. Revisados: estos dos no contienen hoy claves ni tokens, así que no hay fuga actual — pero la regla que existe precisamente para evitarlo no los cubre. | Cambiar la regla puntual por un patrón (`/*.json` con excepciones, o mover todos los exports a un directorio ignorado). |
| Media | `.gitignore:12` vs `.claude/agents/app-expert.md`, `.claude/agents/ui-ux-expert.md` (ambos rastreados) | Se ignora `.claude/` con el motivo "config local de cada máquina", pero dos ficheros de ese directorio están commiteados. El `.gitignore` no afecta a lo ya rastreado. | Contradicción activa: los cambios en esos agentes sí se versionan aunque la regla afirme lo contrario, y `.claude/settings.local.json` (que sí es local) queda oculto. | Desanidar: ignorar `.claude/settings*.json` y versionar `.claude/agents/` de forma explícita. |
| Media | `backend/media-migration-report.json` (rastreado, 46 KB) vs `backend/.dockerignore:14` | Artefacto de una migración puntual, commiteado. Contiene 244 nombres de fichero de multimedia de pacientes con tamaños y tipos MIME. | No son secretos, pero es un inventario de contenido clínico dentro del repositorio de código, y el propio `.dockerignore` lo clasifica como artefacto. | `git rm --cached` y añadirlo a `backend/.gitignore`. |
| Media | `backend/.gitignore` vs `backend/.dockerignore:18-21` | El `.dockerignore` reconoce `.pytest_cache`, `.ruff_cache`, `htmlcov` y `.coverage` como artefactos; el `.gitignore` del backend no ignora ninguno de los cuatro. | Ejecutar la suite deja `backend/.pytest_cache/` visible en `git status`, con riesgo de acabar commiteado. | Añadir los cuatro a `backend/.gitignore`. |
| Baja | `current-state.png`, `fixed-state.png` (raíz, rastreados, 249 KB y 163 KB) | Capturas de depuración commiteadas en la raíz. Los assets reales de la app viven en `frontend/public/` y `frontend/src/assets/`. | Peso muerto y ruido en la raíz del proyecto. | Borrarlas del repo. |
| Baja | `.gitattributes` | Normaliza a LF `*.sh`, `Dockerfile`, `*.conf`, `*.yml`, `*.yaml` y `.env.example`, pero **no** `*.sql` (`backend/migrations/*.sql`, que se aplican en Linux) ni `*.ini` ni `.dockerignore`. | Impacto bajo, pero la lista no cubre todo lo que acaba ejecutándose o leyéndose en Linux, que es el criterio declarado en el propio fichero. | Añadir `*.sql` y `.dockerignore`. |

**No es problema (verificado):** `frontend/storybook-static` no está commiteado
(cubierto por `frontend/.gitignore:14`); `backend/media/` tampoco
(`backend/.gitignore:6`); `db/backups/` solo tiene el `.gitkeep`, con la
negación correcta en `.gitignore:4-5`; `rag.json` está en la raíz sin rastrear y
correctamente ignorado por `.gitignore:18`; y no hay ningún `.env` commiteado.

---

## 10. Puertos, servicios, redes, volúmenes y healthchecks

Mapa verificado (sin desalineaciones salvo lo ya señalado):

| Elemento | Valor | Puntos donde aparece |
| --- | --- | --- |
| Backend | `8000` | `backend/Dockerfile:16,18`, `compose.yml:8,16,19`, `compose.prod.yml:14,20`, `frontend/nginx.conf:22,37,45`, `deploy-bluegreen.sh:74` |
| Frontend (nginx) | `80` | `frontend/Dockerfile:25`, `frontend/nginx.conf:11`, `compose.prod.yml:30`, `traefik/docker-compose.yml:9`, `compose.bluegreen.yml:26` |
| Frontend (vite dev) | `5173` → host `5174` | `frontend/Dockerfile:10-11`, `compose.yml:35`, `compose.yml:14` (CORS), `README.md:187` |
| Blue / Green | `8081` / `8082` | `compose.bluegreen.yml:26`, `traefik/dynamic/active.yml:32`, `deploy-bluegreen.sh:33`, `test_bluegreen_config.py:21` |
| Traefik | `80` / `443` | `traefik/reverse-proxy...:22-23`, `deploy-bluegreen.sh:87` |
| PostgreSQL | `5432` | `compose.db.yml:88`, `backend/.env.example:11`, `README.md:64` |
| Red compartida | `dermicapro-data` | `compose.db.yml:104-106` (crea), `compose.prod.yml:38-40` (external), `ci-cd.yml:150` |
| Volumen de datos | `dermicapro-pgdata` | `compose.db.yml:97-102` |
| Servicio DB | `postgres` (alias explícito) | `compose.db.yml:24,89-92`, `backend/.env.example:11` |
| Healthcheck backend | `/health/ready` | `compose.yml:19`, `compose.prod.yml:14`, `deploy-bluegreen.sh:74`, `backend/main.py:287` |
| Healthcheck DB | `pg_isready -U -d` | `compose.db.yml:65-72` |

| Sev. | Ficheros implicados | Incoherencia | Impacto real | Corrección propuesta |
| --- | --- | --- | --- | --- |
| Baja | `compose.prod.yml:22-32` | El servicio `frontend` no declara `healthcheck` en ningún compose, aunque el backend y la base sí. La comprobación se hace solo desde fuera (`deploy-bluegreen.sh:76`). | Docker no reinicia un nginx en mal estado por sí solo. | Añadir un healthcheck simple sobre `/` en `compose.prod.yml`. |
| Baja | `compose.prod.yml:31-32` | `depends_on: [backend]` sin `condition: service_healthy`, aunque el backend tiene healthcheck definido. | nginx arranca antes de que el backend acepte conexiones; se manifiesta como 502 en los primeros segundos de cada despliegue. | Usar `depends_on: backend: {condition: service_healthy}`. |

---

## 11. CORS, URLs base y VITE_API_BASE_URL

Coherencia dev/prod verificada:

- **Dev**: navegador en `http://localhost:5174` (`compose.yml:35`) → API en
  `http://localhost:8000` (`compose.yml:33`, `frontend/.env.example:2`). Es
  cross-origin, y `compose.yml:14` incluye ese origen en `CORS_ORIGINS`. La
  cookie de sesión es `SameSite=Lax` y el puerto no cambia el *site*, así que
  viaja igual.
- **Prod**: `VITE_API_BASE_URL=""` (`compose.prod.yml:27`, `ci-cd.yml:62`) →
  rutas relativas → mismo origen a través de nginx (`frontend/nginx.conf:21-55`)
  → Traefik termina TLS y nginx propaga `X-Forwarded-Proto`
  (`frontend/nginx.conf:5-8,26`), que es de lo que depende la marca `Secure` de
  la cookie (`backend/config.py:60-64`). Cadena coherente de punta a punta.

Hallazgos ya recogidos en la sección 4: default de `cors_origins` con
`localhost` + `allow_credentials` en producción (Media), documentación de
`CORS_ORIGINS` que contradice su tipo (Media), y ausencia de `localhost:5174`
en el default (Baja).

| Sev. | Ficheros implicados | Incoherencia | Impacto real | Corrección propuesta |
| --- | --- | --- | --- | --- |
| Baja | `frontend/src/api/client.ts:5`, `frontend/src/hooks/useChats.ts:97`, `frontend/src/utils/message.ts:433` | El fallback `'http://localhost:8000'` está duplicado literalmente en tres ficheros. | Cambiar el puerto de desarrollo obliga a tocar tres sitios; olvidar uno deja el WebSocket o las URLs de multimedia apuntando al puerto viejo. | Extraer a una constante única (`src/api/baseUrl.ts`). |

---

## 12. Zona horaria (America/Lima)

| Sev. | Ficheros implicados | Incoherencia | Impacto real | Corrección propuesta |
| --- | --- | --- | --- | --- |
| Media | `backend/services/automation_rules.py:20`, `backend/services/dashboard_service.py:103`, `backend/Dockerfile`, `compose*.yml`, `frontend/src/utils/datetime.ts:4-7` | `America/Lima` es la zona del negocio y está **codificada** en dos servicios del backend, pero ningún contenedor define `TZ`: ni `backend/Dockerfile`, ni los cuatro composes, ni la imagen de PostgreSQL. Los tres corren en UTC. El frontend no fija zona en absoluto: usa la del navegador. | Funciona hoy porque el backend convierte explícitamente (`ZoneInfo` en el motor de automatizaciones y `func.timezone('America/Lima', ...)` en el dashboard) y `requirements.txt:20` incluye `tzdata`. Pero el criterio no está aplicado de forma uniforme: cualquier consulta o log nuevo que use la hora del contenedor sale en UTC, y un vendedor con el reloj del equipo en otra zona ve en el chat y en los programados horas distintas de las que usa el motor de automatizaciones para decidir la ventana de envío. | Fijar `TZ=America/Lima` en la imagen del backend y en `compose.db.yml`, y centralizar la zona en el frontend (formatear siempre con `timeZone: 'America/Lima'`). |
| Baja | `backend/services/automation_rules.py:20` vs `backend/config.py:42`, `backend/services/settings_service.py:59` | `BUSINESS_TIMEZONE_KEY` es una constante fija, mientras que otros parámetros de negocio equivalentes (`default_country_code`) sí son configurables por entorno y editables desde la UI. | Desalineación de criterio; una segunda sede o un cambio de zona exige tocar código. Relevante dado el plan de multi-tenant. | Convertirla en ajuste (`BUSINESS_TIMEZONE` en `config.py` + entrada en `SETTING_DEFS`). |

---

## 13. Resumen ejecutivo

Lo más grave, por orden:

1. **`INBOUND_WEBHOOK_TOKEN` vacío deja los webhooks y la subida de multimedia
   sin autenticación** (`backend/.env.example:29`,
   `backend/services/auth_service.py:113-115`, `backend/main.py:274-275`). Es el
   valor que se entrega en el ejemplo y el código lo trata como "modo abierto".
2. **`MEDIA_STORAGE_BACKEND=local` + ningún volumen en `compose.prod.yml`
   = pérdida de multimedia en cada despliegue** blue-green
   (`backend/services/media_storage.py:26`, `backend/.dockerignore:13`).
3. **El compose de desarrollo apunta a la base de producción por diseño**
   (`compose.yml:11-12`, `README.md:187-192`): no existe base de desarrollo.
4. **`compose.prod.yml` publica `8000:8000` y `80:80` en todas las interfaces**;
   la seguridad depende de que nunca se olvide el fichero de override.
5. **`database_ssl` sigue con default `prefer` y un comentario obsoleto** que
   afirma que el servidor no soporta TLS, cuando `compose.db.yml:44-48` y
   `db/pg_hba.conf:32-37` ya lo exigen.
6. **`ACME_EMAIL` se interpola sin `:?`**: sin `traefik/.env`, Traefik arranca
   sin email y Let's Encrypt no emite certificado.
7. **El healthcheck de Traefik (`path: /`) nunca detecta un backend caído**,
   porque nginx sirve `index.html` con 200 pase lo que pase.
8. **Los exports de n8n sueltos en la raíz no están ignorados**, pese a que el
   `.gitignore` advierte que ese tipo de fichero lleva la API key de Evolution
   embebida (los dos actuales, revisados, no contienen claves).
9. **`.gitignore` ignora `.claude/` pero dos ficheros de ahí están commiteados**;
   y `backend/media-migration-report.json` (inventario de 244 archivos de
   pacientes) está versionado pese a estar clasificado como artefacto en
   `.dockerignore`.
10. **`America/Lima` está codificado en el backend y ningún contenedor fija `TZ`**;
    el frontend usa la zona del navegador, así que backend y UI pueden discrepar.
11. **Ocho variables reales de `config.py` no están en `backend/.env.example`**,
    y la documentación de `CORS_ORIGINS` contradice su tipo (`list[str]` = JSON):
    seguir el comentario impide arrancar el backend.
12. **PyYAML es una dependencia implícita de la suite de tests**, heredada de
    `uvicorn[standard]`, sin declarar en `requirements-dev.txt`.
13. Sin desalineaciones de versión: Node 22 y Python 3.12 coinciden entre
    Dockerfiles y CI. Y **no hay ningún `.env` commiteado**: no existe fuga de
    secretos por esa vía.
