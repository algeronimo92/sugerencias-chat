# 05 - Plan de infraestructura con Terraform para MinIO

Estado del documento: completo (secciones 1 a 7).

Alcance: definir cómo llevar la configuración lógica de MinIO (buckets, políticas,
service accounts, lifecycle, versionado) a Terraform, partiendo del estado real del
repositorio `sugerencias-chat`.

## Indice

1. Inventario del estado actual
2. Frontera: qué gestiona Terraform y qué no
3. Diseño de la solución
4. Código Terraform aplicable
5. Plan de adopción sin downtime
6. Integración en CI/CD
7. Riesgos, trampas y fuera de alcance

---

## 1. Inventario del estado actual

### 1.1 Punto de partida: no hay infraestructura como código

En el repositorio no existe **ningún** fichero `.tf` ni directorio `infra/`
(`git ls-files` no devuelve coincidencias). Todo lo que hoy configura MinIO es
un script imperativo: `scripts/minio-setup.sh`.

### 1.2 Dónde vive el servidor MinIO

El servidor MinIO **no está en este repositorio**. No aparece como servicio en
`compose.yml`, `compose.prod.yml`, `compose.bluegreen.yml` ni `compose.db.yml`
(los cuatro sólo declaran `backend`, `frontend` y `postgres`). Tampoco hay
imagen de MinIO, ni volumen, ni healthcheck asociado.

Lo único que el repo sabe de él es que se alcanza por un endpoint externo:

- `backend/.env.example:76` → `MINIO_ENDPOINT=minio-api.tudominio.com:9000`,
  con la nota explícita de que debe ser `host[:puerto]` sin esquema y apuntar a
  la API S3 (9000), no a la consola.
- `backend/services/media_storage.py:124-131` (`_validate_minio_config`)
  rechaza cualquier endpoint que contenga `://` o `/`.
- `backend/config.py:56-57` → `MINIO_SECURE=true` y `MINIO_VERIFY_TLS=true` por
  defecto: se asume HTTPS con certificado válido.

MinIO tampoco figura en la red privada: `docs/red-privada-wireguard.md` define
un túnel WireGuard `10.10.0.1` (app + PostgreSQL) ↔ `10.10.0.2` (n8n) y sólo
para PostgreSQL. **El repositorio no documenta cómo ni dónde se instaló el
servidor MinIO.** Ese dato hay que obtenerlo del operador antes de escribir el
primer `terraform apply`.

### 1.3 Provisión actual: `scripts/minio-setup.sh`

Es el equivalente artesanal de lo que se quiere llevar a Terraform. Ejecuta
`minio/mc` dentro de un contenedor efímero (`scripts/minio-setup.sh:110-148`) y
hace exactamente cuatro cosas:

| Paso | Líneas | Qué crea |
|---|---|---|
| Bucket | `122-128` | `mc mb target/$BUCKET`, sólo si no existe (idempotente por comprobación previa) |
| Acceso anónimo | `133` | `mc anonymous set none` — bucket **privado siempre** |
| Política | `139-140` | `mc admin policy remove` + `create` de `${APP_USER}-policy` |
| Usuario | `144-146` | `mc admin user remove` + `add` + `mc admin policy attach` |

Detalles que condicionan el diseño de Terraform:

- Es **destructivo por diseño**: borra política y usuario antes de recrearlos
  (`139`, `144`), con el comentario de que encadenar create-o-si-no era frágil.
  Consecuencia: cada ejecución **rota el secreto** de la aplicación.
- El secreto se genera aleatorio de 40 caracteres (`:46`) y se **imprime por
  stdout** (`:161-167`) para copiarlo a mano a `backend/.env`. No se guarda en
  ningún gestor de secretos.
- Requiere las credenciales **root** de MinIO por variable de entorno
  (`:36-37`), que el propio script declara que "solo se usan aquí y no quedan
  guardadas en ningún sitio".
- Lee `MINIO_ENDPOINT`, `MINIO_BUCKET`, `MINIO_SECURE` y `MINIO_PREFIX`
  directamente de `backend/.env` (`read_env`, `:27-33`, `:67`). El fichero de
  configuración de la app es la fuente de verdad de la infraestructura.
- Crea un **usuario** de MinIO (`mc admin user add`), no una *service account*
  (`mc admin user svcacct add`). Es una distinción relevante para Terraform,
  porque el provider expone ambos como recursos distintos (ver sección 3).
- Al final verifica el mínimo privilegio (`:152-158`): que lea su bucket, que
  no liste otros y que no pueda crear buckets.

### 1.4 Buckets y prefijos reales usados por la aplicación

**Un solo bucket.** `settings.minio_bucket` es el único bucket que toca el
código: `stat_object` (`media_storage.py:174-176`), `get_object` (`:217-222`),
`put_object` (`:482-489`), `remove_object` (`:504`), `fput_object` (`:550-556`)
y `bucket_exists` (`:520`). No hay bucket de thumbnails, de backups ni de logs.

- `backend/config.py:54` → `minio_bucket: str = ""` (sin default; obligatorio).
- `backend/.env.example:79` → valor de ejemplo `dermicapro-media`.

**Estructura de claves.** La construye `_object_name_from_filename`
(`media_storage.py:92-95`) sobre `_media_category` (`:81-89`):

```
{MINIO_PREFIX}/{categoria}/{nombre-de-archivo}
```

- `MINIO_PREFIX` por defecto `dermicapro` (`config.py:58` y
  `.env.example:85`). Si se deja vacío, la clave queda sin prefijo (`:95`).
- `categoria` sale del content type: `images` (`image/*`), `audio` (`audio/*`),
  `video` (`video/*`) y `files` para todo lo demás (`:83-89`).

Es decir, los cuatro prefijos reales, tal como los enumera el propio
`.env.example:83-84`:

```
dermicapro/images/*   dermicapro/audio/*   dermicapro/video/*   dermicapro/files/*
```

**No hay jerarquía por fecha, por tenant ni por chat.** El nombre de objeto es
plano dentro de su categoría, y el propio validador lo exige: `_media_filename`
(`:59-67`) rechaza cualquier nombre con `/` o `\`.

**Lectura tolerante entre categorías.** `_object_name_candidates`
(`:102-121`) prueba la categoría inferida y después las otras cuatro, porque
las URLs persistidas en PostgreSQL (`/media/<archivo>`) no guardan el content
type y hay audios antiguos sin extensión. Implicación para Terraform: **no se
puede aplicar una regla de lifecycle distinta por categoría** asumiendo que un
objeto está sólo en su prefijo "correcto".

**Metadatos.** Se escribe `sha256` como metadato de usuario en cada subida
(`:488` y `:555`) y se lee como `x-amz-meta-sha256` (`:164-168`). Lo usa
`upload_local_file_to_minio` (`:528-563`) para verificar la migración.

### 1.5 Permisos y política vigente

La política se genera en `scripts/minio-setup.sh:75-104` y su ámbito se deriva
de `MINIO_PREFIX` (`:67-70`) para que no pueda desincronizarse con dónde
escribe la app:

- Sobre `arn:aws:s3:::$BUCKET`: `s3:GetBucketLocation`, `s3:ListBucket`,
  `s3:ListBucketMultipartUploads`.
- Sobre `arn:aws:s3:::$BUCKET/$PREFIX/*`: `s3:GetObject`, `s3:PutObject`,
  `s3:DeleteObject`, `s3:AbortMultipartUpload`, `s3:ListMultipartUploadParts`.

Las acciones de multipart están justificadas en el comentario `:60-63`: el SDK
parte solo los objetos grandes y el límite de subida son 25 MB; sin ellas
fallarían sólo los vídeos, de forma intermitente.

El usuario de aplicación por defecto es `dermicapro-app`
(`scripts/minio-setup.sh:34`, variable `MINIO_APP_USER`). **Hay una sola
identidad**: la misma credencial lee, escribe y borra. No existe una identidad
de sólo lectura.

### 1.6 Credenciales y variables

Las ocho variables que consume el backend (`backend/config.py:49-58`):

| Variable | Default en `config.py` | En `.env.example` |
|---|---|---|
| `MEDIA_STORAGE_BACKEND` | `"local"` (`:50`) | `:75` → `local` |
| `MINIO_ENDPOINT` | `""` (`:51`) | `:76` |
| `MINIO_ACCESS_KEY` | `""` (`:52`) | `:77` (vacío) |
| `MINIO_SECRET_KEY` | `""` (`:53`) | `:78` (vacío) |
| `MINIO_BUCKET` | `""` (`:54`) | `:79` |
| `MINIO_REGION` | `"us-east-1"` (`:55`) | `:80` |
| `MINIO_SECURE` | `True` (`:56`) | `:81` |
| `MINIO_VERIFY_TLS` | `True` (`:57`) | `:82` |
| `MINIO_PREFIX` | `"dermicapro"` (`:58`) | `:85` |

Gestión de secretos: **ficheros `.env` por servicio**. `backend/.env` no está
commiteado (`.gitignore:2` y `backend/.gitignore:1`) y se inyecta con `env_file`
en `compose.yml:11-12` y `compose.prod.yml:5-6`. No hay Vault, SOPS, ni secretos
de Docker Swarm.

`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD` y `MINIO_APP_USER` sólo existen en la
cabecera de `scripts/minio-setup.sh`; no aparecen en ningún `.env.example`, como
ya recogía `docs/analisis/06-consistencia-configuracion.md:131`.

### 1.7 Políticas de bucket, lifecycle, versionado y notificaciones

Los cuatro, verificados por búsqueda en todo el repositorio:

- **Política de bucket (anónima):** denegada explícitamente
  (`mc anonymous set none`, `scripts/minio-setup.sh:133`). El bucket es privado.
- **Lifecycle / ILM:** **no existe**. Ninguna referencia a `mc ilm`,
  expiración, transición ni tiering. Los objetos se guardan indefinidamente y
  sólo se borran cuando la app llama a `delete_media` (`media_storage.py:496-508`),
  que a su vez sólo se invoca desde el borrado de la biblioteca
  (`media_library_service.delete_media_asset`, `:134-165`) y que **se niega a
  borrar si el archivo está usado en alguna plantilla** (`:158-159`).
- **Versionado:** **no se activa**. No hay `mc version enable` en ningún sitio.
  Sin versionado, un `PutObject` sobre una clave existente es una sobrescritura
  irreversible; la app sólo se protege de eso en el migrador
  (`upload_local_file_to_minio:541-547`, que compara tamaño y sha256 antes de
  pisar nada salvo `--overwrite`).
- **Notificaciones de bucket, replicación, object lock y SSE:** no existen.

### 1.8 Cómo se sirve la media

Por **proxy autenticado del backend**, no con URLs presignadas:
`backend/routers/media.py:161-191` expone `GET|HEAD /media/{filename}` y
devuelve un `StreamingResponse` con soporte de `Range`. Los bytes salen de
`iter_media` / `iter_media_stat` (`media_storage.py:242-261`), que leen del
backend configurado. Consecuencia directa para el diseño: **la política de
Terraform no necesita contemplar acceso público ni CORS de navegador**, porque
ningún cliente habla con MinIO.

### 1.9 El problema que este plan debe resolver

`MEDIA_STORAGE_BACKEND=local` (`.env.example:75`) escribe en `MEDIA_DIR`, que
es `backend/media` dentro del contenedor (`media_storage.py:26-27`).
`compose.prod.yml` **no monta ningún volumen** para esa ruta (sólo declara
`env_file`, `networks`, `healthcheck` y `ports`, `:1-32`). Como el despliegue
blue-green levanta cada color como un proyecto de compose distinto
(`compose.bluegreen.yml:5-8`) y recrea el contenedor, **cada despliegue destruye
el multimedia subido**. Ya está registrado como acción 3 en
`docs/analisis/00-plan-de-mejoras.md:59`.

Además, el cliente MinIO se construye **sin `http_client` ni timeout**
(`media_storage.py:143-150`), lo que deja las descargas colgadas sin corte
(acción 4 del mismo plan, `00-plan-de-mejoras.md:60`).

### 1.10 Herramientas ya presentes

- `minio==7.2.20` en `backend/requirements.txt:14` (SDK de Python).
- `backend/migrate_media_to_minio.py`: migrador de `backend/media` a MinIO con
  verificación por sha256 y sin borrar los originales.
- CI/CD (`.github/workflows/ci-cd.yml`): **cero referencias a MinIO**. El
  despliegue por SSH valida certificados TLS de PostgreSQL y `DATABASE_SSL`
  (`:118-135`), pero no comprueba nada del almacenamiento multimedia.

## 2. Frontera: qué gestiona Terraform y qué no

La regla es simple: **Terraform gestiona lo que hoy hace `scripts/minio-setup.sh`
(el plano lógico, vía la API de administración de MinIO) y nada de lo que hay
por debajo** (el proceso, su disco y su TLS).

### 2.1 Dentro del alcance de Terraform

| Recurso | Qué sustituye hoy | Estado actual |
|---|---|---|
| Bucket de media | `mc mb` (`minio-setup.sh:126`) | Existe, con datos |
| Denegación de acceso anónimo | `mc anonymous set none` (`:133`) | Aplicada |
| Política de mínimo privilegio | `mc admin policy create` (`:140`) | Existe como `dermicapro-app-policy` |
| Identidad de escritura de la app | `mc admin user add` + `attach` (`:145-146`) | Existe como usuario `dermicapro-app` |
| Identidad de sólo lectura | — | **No existe**; la crea este plan |
| Versionado del bucket | — | **No existe**; lo activa este plan |
| Reglas de lifecycle (ILM) | — | **No existe**; las define este plan |
| Notificaciones de bucket | — | No existen y **no se van a crear** (ver 2.3) |

Justificación de los dos que se añaden:

- **Versionado**: hoy un `put_object` sobre una clave existente sobrescribe sin
  vuelta atrás (`media_storage.py:482-489`), y la app **no lo previene** salvo en
  el migrador. Activarlo convierte un borrado accidental en algo recuperable.
  Trae una consecuencia obligatoria: sin lifecycle, las versiones no expiran
  nunca y el bucket crece sin techo. Versionado y ILM van juntos o no van.
- **Lifecycle**: sirve para expirar versiones no actuales, cortar los
  *multipart uploads* abandonados (que la propia política contempla con
  `s3:AbortMultipartUpload`, `minio-setup.sh:96`) y limpiar marcadores de
  borrado. **No** para expirar objetos actuales: son adjuntos de conversaciones
  clínicas referenciados desde PostgreSQL (`media_assets.media_url`), y un
  objeto que desaparece deja una fila apuntando al vacío.

### 2.2 Fuera del alcance de Terraform

**El servidor MinIO en sí.** Terraform no lo instala, no lo actualiza, no
dimensiona su disco, no configura su TLS ni lo pone detrás de Traefik. El
provider de MinIO habla con un servidor **que ya tiene que estar en pie y
respondiendo**; sin él, ni siquiera se puede hacer `terraform plan` con estado
remoto en ese mismo MinIO (ver 3.4).

Concretamente quedan fuera:

1. **Despliegue del proceso MinIO.** Sea contenedor, binario o servicio
   gestionado, no está en este repositorio (sección 1.2) y no se sabe dónde
   corre. Si en algún momento se decide traerlo al repo, su sitio natural es un
   `compose.minio.yml` con su propio proyecto y su propio volumen nombrado, con
   el mismo criterio que `compose.db.yml:1-19` aplica a PostgreSQL: ciclo de
   vida separado de la aplicación para que un despliegue no pueda tocarlo.
2. **Las credenciales root de MinIO** (`MINIO_ROOT_USER` /
   `MINIO_ROOT_PASSWORD`). Terraform las **consume**, no las crea. Se pasan por
   entorno, nunca en un `.tfvars` versionado.
3. **El certificado TLS del endpoint** (`MINIO_SECURE=true`,
   `MINIO_VERIFY_TLS=true`, `config.py:56-57`). Lo emite quien publique el
   endpoint, igual que hoy hace Traefik con `letsencrypt`
   (`traefik/reverse-proxy.docker-compose.yml:24-27`).
4. **`backend/.env`.** Terraform genera credenciales pero **no las escribe en el
   `.env` del servidor**: eso lo sigue haciendo el operador o el despliegue. Un
   Terraform que edite ficheros del host es un Terraform que necesita acceso SSH
   a producción, y eso amplía la superficie sin ganar nada.
5. **El backend de estado (bucket `terraform-state`) en su primera creación.**
   Problema clásico del huevo y la gallina; se resuelve en 3.4.
6. **La migración de datos.** Copiar `backend/media` a MinIO ya tiene su
   herramienta (`backend/migrate_media_to_minio.py`) y no debe convertirse en un
   `null_resource`.
7. **El volumen de media del blue-green.** El arreglo de la pérdida de datos
   (sección 1.9) es un cambio en `compose.prod.yml` o un `MEDIA_STORAGE_BACKEND=minio`
   en `backend/.env`, no un recurso de Terraform. Ver 5.1.

### 2.3 Notificaciones de bucket: se decide no gestionarlas

El provider expone notificaciones de bucket, pero MinIO exige que el **destino**
(webhook, AMQP, Redis…) esté declarado en la configuración del servidor
(`mc admin config set target notify_webhook:...`) **antes** de poder asociar un
evento al bucket. Esa mitad vive en el servidor, que está fuera de alcance
(2.2.1), así que gestionar sólo la otra mitad produce un `apply` que falla con
`InvalidArgument: A specified destination ARN does not exist`.

Además la aplicación no las necesita: escribe y lee de forma síncrona
(`media_storage.py:472-493`) y no hay ningún consumidor de eventos de
almacenamiento en el repositorio.

Se deja documentado como extensión futura, no como parte de este plan.

### 2.4 Resumen de la frontera

```
┌─ Fuera de Terraform ───────────────────────────────────────────┐
│ Host / contenedor MinIO · disco · TLS · credenciales root      │
│ backend/.env · migración de datos · volumen de media en compose│
└────────────────────────────────────────────────────────────────┘
                              │ API de administración (S3 + admin)
                              ▼
┌─ Dentro de Terraform ──────────────────────────────────────────┐
│ bucket · versionado · ILM · política de acceso anónimo          │
│ policies IAM (rw y ro) · service accounts (rw y ro)             │
└────────────────────────────────────────────────────────────────┘
```

## 3. Diseño de la solución

### 3.1 Estructura de directorios

Un módulo único reutilizable y dos entornos que lo instancian. No hay
`modules/bucket`, `modules/policy` y `modules/user` por separado: son tres
recursos acoplados entre sí (la política referencia el ARN del bucket y la
service account referencia la política) y partirlos sólo añade `variable`s de
paso.

```
infra/
└── terraform/
    ├── README.md                     # cómo ejecutar, y qué NO gestiona
    ├── modules/
    │   └── media-bucket/
    │       ├── versions.tf           # required_version + required_providers
    │       ├── variables.tf
    │       ├── buckets.tf            # bucket + versionado + acceso anónimo
    │       ├── policies.tf           # políticas IAM rw y ro
    │       ├── identities.tf         # usuarios + service accounts rw y ro
    │       ├── lifecycle.tf          # reglas ILM
    │       └── outputs.tf
    └── envs/
        ├── dev/
        │   ├── versions.tf
        │   ├── providers.tf          # provider + backend de estado
        │   ├── main.tf               # module "media" { ... }
        │   ├── variables.tf
        │   ├── outputs.tf
        │   ├── terraform.tfvars      # valores NO secretos, versionado
        │   └── backend.hcl.example   # config del backend, sin credenciales
        └── prod/
            └── (los mismos ficheros)
```

Convenciones que se heredan del repositorio:

- `.gitignore` debe crecer con `infra/terraform/**/.terraform/`,
  `*.tfstate`, `*.tfstate.*`, `.terraform.lock.hcl` **no** (ese sí se
  versiona), `*.auto.tfvars` y `backend.hcl`. Hoy `.gitignore:1-3` ya sigue el
  criterio de excluir los `.env` por servicio.
- Los comentarios en español y explicando el *porqué*, como el resto de ficheros
  de infraestructura del repo (`compose.db.yml`, `scripts/minio-setup.sh`).

### 3.2 Providers y versiones

**Opción A (recomendada): el provider dedicado de MinIO.**

En el Terraform Registry el provider comunitario de MinIO es
**`aminueza/minio`**. Es el que expone los recursos de administración que hacen
falta (`minio_s3_bucket`, `minio_iam_policy`, `minio_iam_user`,
`minio_iam_service_account`, `minio_ilm_policy`, `minio_s3_bucket_versioning`).

> **Advertencia explícita de incertidumbre.** El nombre `aminueza/minio` es
> correcto según mi conocimiento, pero **no puedo verificar desde este
> repositorio ni la versión exacta publicada ni el conjunto exacto de
> argumentos de cada recurso**, y este provider ha cambiado nombres de
> atributos entre versiones mayores (por ejemplo, en las series 1.x/2.x
> `minio_s3_bucket` usaba `acl` y `object_locking`, y el bloque de versionado
> pasó a ser un recurso aparte). **Antes de aplicar nada hay que abrir
> `registry.terraform.io/providers/aminueza/minio/latest/docs`, fijar la versión
> exacta en `required_providers` y contrastar los argumentos** contra el código
> de la sección 4, que está escrito para la serie 2.x/3.x. El `plan` es la
> comprobación: si un atributo no existe, falla en validación, no en
> producción.

**Opción B (alternativa segura): el provider de AWS apuntando a MinIO.**

Si el provider de MinIO no está disponible, no se puede auditar, o su versión
resulta incompatible, `hashicorp/aws` funciona contra MinIO por su
compatibilidad S3, con endpoint personalizado y *path-style*:

```hcl
provider "aws" {
  region                      = var.minio_region      # "us-east-1"
  access_key                  = var.minio_root_user
  secret_key                  = var.minio_root_password

  # MinIO no tiene STS/IAM/metadata de EC2: sin esto, el provider intenta
  # validar la cuenta contra AWS de verdad y el plan se cuelga o falla.
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_region_validation      = true
  skip_requesting_account_id  = true

  endpoints {
    s3 = "https://${var.minio_endpoint}"
  }

  # Obligatorio: MinIO no resuelve buckets como subdominio
  # (bucket.host), sólo como ruta (host/bucket).
  s3_use_path_style = true
}
```

Con esta opción se cubren `aws_s3_bucket`, `aws_s3_bucket_versioning`,
`aws_s3_bucket_lifecycle_configuration`, `aws_s3_bucket_policy` y
`aws_s3_bucket_public_access_block`. **Lo que NO cubre son las identidades**:
los recursos `aws_iam_*` hablan con el servicio IAM de AWS, que MinIO no
implementa. Es decir, con la opción B **el usuario y su política siguen
creándose con `scripts/minio-setup.sh`** y Terraform gestiona sólo el bucket y
sus propiedades. Es una degradación aceptable pero real, y hay que decidirla con
los ojos abiertos.

La recomendación es intentar A y quedarse en B sólo si A no valida.

**Versiones fijadas.** Con el mismo criterio que `compose.db.yml:26-28`
(PostgreSQL fijado por versión) y `traefik/reverse-proxy.docker-compose.yml:2-6`
(traefik fijado a `3.7.9`), aquí también se pinea:

```hcl
required_version = "~> 1.9"           # o la que se instale en el runner
minio = { source = "aminueza/minio", version = "~> 2.0" }   # CONFIRMAR EN EL REGISTRY
```

Y se **commitea `.terraform.lock.hcl`**, que es lo que garantiza el mismo
provider byte a byte en la máquina del operador y en CI.

### 3.3 Autenticación del provider

El provider necesita credenciales con permisos de administración. Se le pasan
por variables de entorno, **nunca** por `.tfvars`:

```bash
export MINIO_USER=...            # root o un usuario con policy consoleAdmin
export MINIO_PASSWORD=...
export MINIO_ENDPOINT=minio-api.tudominio.com:9000
export MINIO_SSL=true
```

> **Incertidumbre**: los nombres de las variables de entorno que el provider
> lee automáticamente (`MINIO_USER`/`MINIO_PASSWORD` frente a
> `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD`) dependen de la versión. Para no
> depender de eso, en la sección 4 el `providers.tf` **declara los argumentos
> explícitamente** y los alimenta desde variables `TF_VAR_*`, que sí son un
> contrato estable de Terraform.

Nota de coherencia: `scripts/minio-setup.sh:36-37` usa `MINIO_ROOT_USER` /
`MINIO_ROOT_PASSWORD`. Conviene reutilizar esos mismos nombres en el `.env` de
operación para no tener dos convenciones.

### 3.4 Estado remoto

**Evaluación de usar el propio MinIO como backend S3.** Terraform trae el
backend `s3`, que apunta a MinIO igual que en la opción B: `endpoints.s3`,
`use_path_style = true` y los `skip_*`. Es tentador porque no añade
infraestructura nueva.

Tiene dos problemas concretos que hay que aceptar antes de elegirlo:

1. **Arranque en frío (huevo y gallina).** El bucket de estado tiene que existir
   *antes* del primer `terraform init`, y no lo puede crear el mismo Terraform
   que lo va a usar. Solución: crearlo una sola vez a mano, documentado, con la
   misma herramienta que ya se usa:
   `docker run --rm -e MC_HOST_t=... minio/mc mb t/dermicapro-tfstate`, o
   añadiéndolo a `scripts/minio-setup.sh`. **Y activarle versionado**, que es
   la red de seguridad real ante un estado corrupto.
   Segundo efecto del arranque en frío, más incómodo: **si MinIO está caído, no
   se puede ni planificar**. El estado y el objeto gestionado comparten destino
   fallo. Con PostgreSQL ya se resolvió algo parecido separando ciclos de vida
   (`compose.db.yml:1-11`); aquí no se puede separar, sólo asumirlo.
2. **Bloqueo (locking).** El backend `s3` clásico bloqueaba con DynamoDB, que
   MinIO no tiene. Las versiones recientes de Terraform soportan bloqueo por
   objeto (`use_lockfile = true`, que escribe un `.tflock` junto al estado) y
   eso **sí** funciona contra MinIO. **No puedo confirmar desde aquí la versión
   mínima exacta de Terraform que lo incluye**; hay que verificarlo contra la
   versión que se instale. Si la versión disponible no lo soporta, quedan dos
   salidas honestas: (a) **sin bloqueo**, aceptable sólo porque aquí hay un
   único operador y un único job de CI, y mitigable serializando el workflow con
   `concurrency` en GitHub Actions (sección 6); o (b) mover el estado a un
   backend con bloqueo nativo.

**Recomendación**: empezar por el backend `local` para el `import` inicial
(sección 5), y pasar a `s3` sobre MinIO en cuanto el estado sea correcto. Es
menos elegante y evita depurar dos cosas a la vez.

La configuración del backend va **parcial**, en `backend.hcl` fuera de git, para
que las credenciales no acaben en un fichero versionado:

```hcl
terraform {
  backend "s3" {}   # se completa con -backend-config=backend.hcl
}
```

### 3.5 Secretos fuera del estado en claro

Hay que decirlo sin adornos: **el estado de Terraform contiene los secretos en
claro**. Si Terraform crea una service account, su `secret_key` queda escrita en
el `tfstate`. Marcar un output como `sensitive` sólo lo oculta de la consola.

Medidas, en orden de importancia:

1. **El estado nunca en git.** `*.tfstate*` en `.gitignore` desde el primer
   commit.
2. **El bucket de estado, cerrado.** Bucket propio (`dermicapro-tfstate`),
   distinto del de media, con acceso anónimo denegado y accesible sólo por una
   credencial dedicada al pipeline. Ese bucket **no** debe estar en el ámbito de
   la política de la aplicación, que ya está acotada a
   `arn:aws:s3:::$BUCKET/$PREFIX/*` (`minio-setup.sh:70`).
3. **Cifrado en reposo del estado.** `encrypt = true` en el backend `s3` activa
   SSE-S3; en MinIO eso requiere KMS configurado en el servidor. Si no lo hay,
   la protección real es el cifrado de disco del host, y hay que asumirlo por
   escrito en vez de creer que `encrypt = true` basta.
4. **Secretos de entrada por variable de entorno**, no por `.tfvars`: las
   credenciales root sólo viven en la sesión del operador o en los secrets de
   GitHub Actions.
5. **Secretos de salida no impresos.** Los outputs con `secret_key` van con
   `sensitive = true` y se extraen a mano con `terraform output -raw` cuando hay
   que rotar el `.env`, nunca en el log de CI.
6. **Alternativa a evaluar**: no dejar que Terraform genere los secretos, sino
   pasárselos ya creados desde un gestor externo. Reduce la exposición pero no
   la elimina (siguen en el estado). En este proyecto, donde hoy el secreto se
   imprime por stdout y se copia a mano (`minio-setup.sh:161-167`), el estado
   cifrado en un bucket privado ya es una mejora, no un retroceso.

### 3.6 Recursos por entorno e identidades separadas

Cada entorno instancia el módulo con su propio bucket. **Un bucket por entorno,
no un prefijo por entorno**: compartir bucket significa compartir política,
versionado y lifecycle, y que un `terraform destroy` de dev pueda tocar
producción.

| | dev | prod |
|---|---|---|
| Bucket | `dermicapro-media-dev` | `dermicapro-media` |
| Prefijo (`MINIO_PREFIX`) | `dermicapro` | `dermicapro` |
| Versionado | activado | activado |
| Expiración de versiones no actuales | 7 días | 30 días |
| Multipart abandonados | 1 día | 7 días |
| Identidad de escritura | `dermicapro-app-dev` | `dermicapro-app` |
| Identidad de lectura | `dermicapro-ro-dev` | `dermicapro-ro` |

El prefijo se mantiene igual en ambos porque es lo que la aplicación construye
en `_object_name_from_filename` (`media_storage.py:92-95`); cambiarlo por
entorno obligaría a que `_object_name_candidates` (`:102-121`) probara aún más
combinaciones. La separación va en el bucket, que sí es una variable limpia
(`MINIO_BUCKET`).

**Por qué dos identidades.** Hoy hay una sola credencial que lee, escribe y
borra (sección 1.5). Se separa en:

- **rw** — la que consume el backend. Permisos exactos a los de
  `minio-setup.sh:75-104`, ni uno más: `GetObject`, `PutObject`, `DeleteObject`,
  las dos de multipart, y a nivel de bucket `GetBucketLocation`, `ListBucket`,
  `ListBucketMultipartUploads` (`bucket_exists` de `media_storage.py:520`
  necesita las de bucket).
- **ro** — sin `PutObject` ni `DeleteObject`. Para lo que hoy no tiene
  credencial propia y acaba usando la de la app: auditorías, backups del bucket,
  el `--dry-run` de `migrate_media_to_minio.py`, o depurar desde una laptop.
  Es la credencial que se puede compartir sin miedo.

**Usuario frente a service account.** El provider ofrece las dos cosas y hacen
falta las dos:

- `minio_iam_user` + `minio_iam_user_policy_attachment`: la identidad y su
  política. Es lo que hoy crea `mc admin user add` (`minio-setup.sh:145`).
- `minio_iam_service_account`: una credencial derivada de ese usuario, que
  hereda sus permisos (o menos) y **se puede rotar sin tocar la identidad**.

Diseño elegido: **el usuario es la identidad estable, la service account es la
credencial que consume el backend**. Rotar el secreto pasa a ser
`terraform taint` de la service account, no borrar y recrear el usuario como
hace hoy el script (`:144-146`). El otro beneficio es de auditoría: en los logs
de MinIO la acción sigue atribuida al usuario padre aunque la credencial haya
cambiado tres veces.

## 4. Código Terraform aplicable

Todo lo que sigue está escrito contra los nombres **reales** del repositorio:
bucket `dermicapro-media` (`backend/.env.example:79`), prefijo `dermicapro`
(`backend/config.py:58`), usuario `dermicapro-app`
(`scripts/minio-setup.sh:34`) y las mismas acciones S3 de la política vigente
(`scripts/minio-setup.sh:75-104`).

Recordatorio de la sección 3.2: **los nombres de atributo de cada recurso hay
que contrastarlos con la versión del provider que se fije**. Lo que no cambia
entre versiones es el JSON de las políticas y la estructura de claves, que es lo
que de verdad hay que acertar.

### 4.1 `modules/media-bucket/versions.tf`

```hcl
terraform {
  # Se fija con "~>" y no con "latest" por la misma razón que traefik está
  # clavado en 3.7.9 y PostgreSQL en 16.10-alpine: que un `init` cualquiera
  # no cambie el comportamiento sin que nadie lo haya pedido.
  required_version = "~> 1.9"

  required_providers {
    minio = {
      source = "aminueza/minio"
      # CONFIRMAR en registry.terraform.io/providers/aminueza/minio/latest
      # antes del primer apply. Al fijarla, commitear .terraform.lock.hcl.
      version = "~> 2.0"
    }
  }
}
```

### 4.2 `envs/prod/providers.tf`

```hcl
# Las credenciales se declaran explícitamente en vez de confiar en que el
# provider lea unas variables de entorno concretas: el nombre de esas
# variables ha cambiado entre versiones del provider, mientras que TF_VAR_*
# es un contrato estable de Terraform.
provider "minio" {
  minio_server   = var.minio_endpoint      # host[:puerto], sin esquema
  minio_user     = var.minio_admin_user    # TF_VAR_minio_admin_user
  minio_password = var.minio_admin_password
  minio_region   = var.minio_region
  minio_ssl      = var.minio_ssl
}

terraform {
  # Parcial a propósito: se completa con
  #   terraform init -backend-config=backend.hcl
  # y ese backend.hcl NO se versiona, porque lleva credenciales.
  backend "s3" {}
}
```

`envs/prod/backend.hcl.example` (este sí se versiona, sin secretos):

```hcl
bucket = "dermicapro-tfstate"
key    = "minio/prod/terraform.tfstate"
region = "us-east-1"

endpoints = {
  s3 = "https://minio-api.tudominio.com:9000"
}

# MinIO resuelve buckets por ruta (host/bucket), no por subdominio.
use_path_style = true

# MinIO no expone STS, IAM ni la metadata de EC2. Sin estos cuatro, el
# provider intenta validar la cuenta contra AWS de verdad.
skip_credentials_validation = true
skip_metadata_api_check     = true
skip_region_validation      = true
skip_requesting_account_id  = true

# Bloqueo por objeto: escribe un .tflock junto al estado. No requiere
# DynamoDB, que MinIO no tiene.
# VERIFICAR que la versión de Terraform instalada lo soporta; si no, hay
# que serializar el workflow con `concurrency` en GitHub Actions.
use_lockfile = true

# access_key / secret_key van por entorno:
#   AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY
```

### 4.3 `modules/media-bucket/variables.tf`

```hcl
variable "bucket_name" {
  description = "Bucket de multimedia. Es el valor de MINIO_BUCKET en backend/.env."
  type        = string
}

variable "media_prefix" {
  description = <<-EOT
    Prefijo bajo el que la aplicación escribe. Debe coincidir con MINIO_PREFIX
    (backend/config.py:58, por defecto "dermicapro"). Si no coincide, la app
    escribe fuera del ámbito de la política y todo falla con AccessDenied.
    Vacío = sin prefijo, y entonces la política cubre el bucket entero.
  EOT
  type        = string
  default     = "dermicapro"

  validation {
    condition     = !startswith(var.media_prefix, "/") && !endswith(var.media_prefix, "/")
    error_message = "media_prefix va sin barras al principio ni al final."
  }
}

variable "app_user_name" {
  description = "Identidad de lectura/escritura de la aplicación."
  type        = string
  default     = "dermicapro-app"
}

variable "readonly_user_name" {
  description = "Identidad de sólo lectura para auditoría y backups."
  type        = string
  default     = "dermicapro-ro"
}

variable "versioning_enabled" {
  description = "Versionado del bucket. Activarlo SIN lifecycle hace crecer el bucket sin techo."
  type        = bool
  default     = true
}

variable "noncurrent_version_expiration_days" {
  description = "Días que sobrevive una versión no actual antes de expirar."
  type        = number
  default     = 30
}

variable "abort_multipart_days" {
  description = "Días tras los que se aborta un multipart upload sin terminar."
  type        = number
  default     = 7
}

variable "force_destroy" {
  description = <<-EOT
    Permite borrar el bucket con objetos dentro. FALSE en producción, sin
    excepciones: aquí viven adjuntos de conversaciones de pacientes
    referenciados desde media_assets.media_url en PostgreSQL.
  EOT
  type        = bool
  default     = false
}
```

### 4.4 `modules/media-bucket/buckets.tf`

```hcl
locals {
  bucket_arn = "arn:aws:s3:::${var.bucket_name}"

  # Las claves son {prefijo}/{categoria}/{archivo}, con categoria en
  # images|audio|video|files (services/media_storage.py:81-95). El ámbito
  # se deriva del prefijo, igual que hace scripts/minio-setup.sh:67-70,
  # para que política y aplicación no puedan desincronizarse.
  object_arn = var.media_prefix == "" ? "${local.bucket_arn}/*" : "${local.bucket_arn}/${var.media_prefix}/*"
}

resource "minio_s3_bucket" "media" {
  bucket = var.bucket_name

  # Privado siempre. La aplicación sirve los archivos por su propio endpoint
  # autenticado con StreamingResponse (routers/media.py:161-191), así que
  # nadie más necesita hablar con MinIO. Un bucket público dejaría las fotos
  # de pacientes accesibles a quien adivine una URL.
  # Equivale a `mc anonymous set none` (scripts/minio-setup.sh:133).
  acl = "private"

  force_destroy = var.force_destroy
}

resource "minio_s3_bucket_versioning" "media" {
  bucket = minio_s3_bucket.media.bucket

  versioning_configuration {
    status = var.versioning_enabled ? "Enabled" : "Suspended"
  }
}
```

> Nota sobre el versionado: **una vez activado no se puede volver a
> "Disabled"**, sólo a "Suspended". Es una decisión de ida.

### 4.5 `modules/media-bucket/policies.tf`

```hcl
# Política de lectura/escritura. Es la misma que genera hoy
# scripts/minio-setup.sh:75-104, acción por acción:
#
#   bucket_exists -> ListBucket           put_object/fput_object -> PutObject
#   get_object    -> GetObject            remove_object          -> DeleteObject
#   stat_object   -> GetObject
#
# Las de multipart no son opcionales: el SDK de MinIO parte solo los objetos
# grandes y el límite de subida de la app son 25 MB. Sin ellas las imágenes
# pequeñas suben y los vídeos fallan con AccessDenied, de forma intermitente
# y difícil de atribuir.
resource "minio_iam_policy" "media_rw" {
  name = "${var.app_user_name}-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "BucketAccess"
        Effect = "Allow"
        Action = [
          "s3:GetBucketLocation",
          "s3:ListBucket",
          "s3:ListBucketMultipartUploads",
        ]
        Resource = [local.bucket_arn]
      },
      {
        Sid    = "MediaObjectAccess"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:AbortMultipartUpload",
          "s3:ListMultipartUploadParts",
        ]
        Resource = [local.object_arn]
      },
    ]
  })
}

# Política de sólo lectura: lo mismo sin PutObject ni DeleteObject. Para
# auditorías, backups del bucket y el --dry-run de migrate_media_to_minio.py.
# Es la credencial que se puede compartir sin que nadie pueda romper nada.
resource "minio_iam_policy" "media_ro" {
  name = "${var.readonly_user_name}-policy"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "BucketAccess"
        Effect   = "Allow"
        Action   = ["s3:GetBucketLocation", "s3:ListBucket"]
        Resource = [local.bucket_arn]
      },
      {
        Sid      = "MediaObjectRead"
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = [local.object_arn]
      },
    ]
  })
}
```

### 4.6 `modules/media-bucket/identities.tf`

```hcl
# El usuario es la identidad ESTABLE; la service account es la credencial
# que consume el backend. Así rotar el secreto es recrear la service account
# (`terraform taint`), no borrar y recrear el usuario como hace hoy
# scripts/minio-setup.sh:144-146 — que además invalida la credencial en uso.
# En los logs de MinIO la acción sigue atribuida al usuario padre.

resource "minio_iam_user" "app" {
  name = var.app_user_name

  # El secreto del usuario padre no lo usa nadie: la app usa la service
  # account. Se genera igualmente porque MinIO lo exige al crear el usuario.
  secret = random_password.app_user.result

  # No re-envía el secreto en cada apply; si no, cada plan sale sucio.
  update_secret = false

  # No borrar el usuario si tiene políticas o service accounts colgando:
  # que falle el destroy es preferible a dejar la app sin credencial.
  force_destroy = false
}

resource "minio_iam_user_policy_attachment" "app" {
  user_name   = minio_iam_user.app.id
  policy_name = minio_iam_policy.media_rw.id
}

# La credencial real del backend: MINIO_ACCESS_KEY / MINIO_SECRET_KEY.
resource "minio_iam_service_account" "app" {
  target_user = minio_iam_user.app.name

  depends_on = [minio_iam_user_policy_attachment.app]
}

resource "minio_iam_user" "readonly" {
  name          = var.readonly_user_name
  secret        = random_password.readonly_user.result
  update_secret = false
  force_destroy = false
}

resource "minio_iam_user_policy_attachment" "readonly" {
  user_name   = minio_iam_user.readonly.id
  policy_name = minio_iam_policy.media_ro.id
}

resource "minio_iam_service_account" "readonly" {
  target_user = minio_iam_user.readonly.name

  depends_on = [minio_iam_user_policy_attachment.readonly]
}

# 40 caracteres, como los secretos que genera MinIO y como hace
# scripts/minio-setup.sh:46. Sin símbolos especiales: viajan dentro de una
# URL de conexión de `mc` (MC_HOST_...) y ahí un "/" o un "@" rompen el
# parseo. Ese fue el motivo de que el script filtre '/+=' del base64.
resource "random_password" "app_user" {
  length  = 40
  special = false
}

resource "random_password" "readonly_user" {
  length  = 40
  special = false
}
```

`random` hay que añadirlo a `required_providers`:

```hcl
random = {
  source  = "hashicorp/random"
  version = "~> 3.6"
}
```

### 4.7 `modules/media-bucket/lifecycle.tf`

```hcl
# Sólo se expiran VERSIONES NO ACTUALES y multipart abandonados. Nunca el
# objeto actual: cada uno está referenciado desde media_assets.media_url en
# PostgreSQL, y borrarlo deja una fila apuntando al vacío (la app respondería
# 404 en GET /media/{filename}, routers/media.py:161).
#
# Esta regla es la contrapartida obligatoria del versionado: sin ella, cada
# sobrescritura acumula una copia que no caduca nunca.
resource "minio_ilm_policy" "media" {
  count  = var.versioning_enabled ? 1 : 0
  bucket = minio_s3_bucket.media.bucket

  rule {
    id = "expirar-versiones-no-actuales"
    noncurrent_expiration {
      days = var.noncurrent_version_expiration_days
    }
  }
}
```

> **Punto a verificar antes de aplicar.** No puedo confirmar desde aquí que
> `minio_ilm_policy` exponga `AbortIncompleteMultipartUpload` en la versión que
> se fije; en algunas versiones la regla sólo cubre `expiration`,
> `noncurrent_expiration` y `transition`. Si no está disponible, la limpieza de
> multipart abandonados se hace fuera de Terraform y se documenta como tal:
>
> ```bash
> docker run --rm -e MC_HOST_t="https://ROOT:PASS@$MINIO_ENDPOINT" minio/mc \
>   ilm rule add --expire-delete-marker \
>   --noncurrent-expire-days 30 t/dermicapro-media
> ```
>
> No aplicar un filtro por prefijo en esta regla es deliberado: la lectura
> tolerante entre categorías (`_object_name_candidates`,
> `media_storage.py:102-121`) significa que un mismo archivo puede estar bajo
> `images/`, `audio/`, `video/` o `files/`, así que una regla por categoría
> daría un tratamiento distinto a objetos equivalentes.

### 4.8 `modules/media-bucket/outputs.tf`

```hcl
output "bucket_name" {
  description = "Valor para MINIO_BUCKET en backend/.env."
  value       = minio_s3_bucket.media.bucket
}

output "media_prefix" {
  description = "Valor para MINIO_PREFIX en backend/.env."
  value       = var.media_prefix
}

output "object_scope_arn" {
  description = "Ámbito de la política. Debe cubrir lo que escribe _object_name_from_filename."
  value       = local.object_arn
}

# OJO: aunque estén marcados sensitive, estos valores quedan EN CLARO en el
# tfstate. Por eso el bucket de estado va aparte, privado y cifrado (ver 3.5).
output "app_access_key" {
  description = "MINIO_ACCESS_KEY de la aplicación."
  value       = minio_iam_service_account.app.access_key
  sensitive   = true
}

output "app_secret_key" {
  description = "MINIO_SECRET_KEY de la aplicación. Extraer con: terraform output -raw app_secret_key"
  value       = minio_iam_service_account.app.secret_key
  sensitive   = true
}

output "readonly_access_key" {
  value     = minio_iam_service_account.readonly.access_key
  sensitive = true
}

output "readonly_secret_key" {
  value     = minio_iam_service_account.readonly.secret_key
  sensitive = true
}
```

### 4.9 `envs/prod/main.tf`

```hcl
module "media" {
  source = "../../modules/media-bucket"

  bucket_name        = "dermicapro-media"
  media_prefix       = "dermicapro"
  app_user_name      = "dermicapro-app"
  readonly_user_name = "dermicapro-ro"

  versioning_enabled                 = true
  noncurrent_version_expiration_days = 30
  abort_multipart_days               = 7

  # En producción, jamás. El bucket guarda adjuntos de conversaciones reales.
  force_destroy = false
}
```

`envs/prod/variables.tf`:

```hcl
variable "minio_endpoint" {
  description = "host[:puerto] de la API S3 (9000), sin esquema. Igual que MINIO_ENDPOINT."
  type        = string
}

variable "minio_region" {
  type    = string
  default = "us-east-1"   # coincide con backend/config.py:55
}

variable "minio_ssl" {
  type    = bool
  default = true          # coincide con MINIO_SECURE (backend/config.py:56)
}

# Sin default y sin aparecer en ningún .tfvars: se pasan por TF_VAR_*.
variable "minio_admin_user" {
  type      = string
  sensitive = true
}

variable "minio_admin_password" {
  type      = string
  sensitive = true
}
```

`envs/prod/outputs.tf`:

```hcl
output "app_access_key" {
  value     = module.media.app_access_key
  sensitive = true
}

output "app_secret_key" {
  value     = module.media.app_secret_key
  sensitive = true
}

output "bucket_name"      { value = module.media.bucket_name }
output "object_scope_arn" { value = module.media.object_scope_arn }
```

### 4.10 `envs/prod/terraform.tfvars` (versionado, sin secretos)

```hcl
# Sólo valores NO secretos. Las credenciales de administración van por
# entorno:
#   export TF_VAR_minio_admin_user=...
#   export TF_VAR_minio_admin_password=...
minio_endpoint = "minio-api.tudominio.com:9000"
minio_region   = "us-east-1"
minio_ssl      = true
```

### 4.11 `envs/dev/main.tf`

```hcl
module "media" {
  source = "../../modules/media-bucket"

  # Bucket propio, no un prefijo dentro del de producción: compartir bucket
  # es compartir política, versionado y lifecycle, y hace posible que un
  # destroy de dev toque producción.
  bucket_name        = "dermicapro-media-dev"
  media_prefix       = "dermicapro"
  app_user_name      = "dermicapro-app-dev"
  readonly_user_name = "dermicapro-ro-dev"

  versioning_enabled                 = true
  noncurrent_version_expiration_days = 7
  abort_multipart_days               = 1

  # En dev sí: el bucket se tira y se rehace sin consecuencias.
  force_destroy = true
}
```

### 4.12 Correspondencia con `backend/.env`

Tras el `apply`, lo que hay que poner en el `.env` del servidor:

```bash
MEDIA_STORAGE_BACKEND=minio
MINIO_ENDPOINT=minio-api.tudominio.com:9000
MINIO_ACCESS_KEY=$(terraform -chdir=infra/terraform/envs/prod output -raw app_access_key)
MINIO_SECRET_KEY=$(terraform -chdir=infra/terraform/envs/prod output -raw app_secret_key)
MINIO_BUCKET=dermicapro-media
MINIO_REGION=us-east-1
MINIO_SECURE=true
MINIO_VERIFY_TLS=true
MINIO_PREFIX=dermicapro
```

`MINIO_PREFIX` **tiene que coincidir** con `media_prefix` del módulo: es la
variable de la que se deriva `local.object_arn` y también la que usa
`_object_name_from_filename` (`media_storage.py:92-95`). Si divergen, la app
escribe fuera del ámbito de su política y todo falla con `AccessDenied`. Un
guardarraíl barato en CI, del mismo estilo que la comprobación de
`DATABASE_SSL=require` en `.github/workflows/ci-cd.yml:130-135`:

```bash
grep -qE "^MINIO_PREFIX=$(terraform output -raw media_prefix)$" backend/.env
```

## 5. Plan de adopción sin downtime

La premisa: **el bucket ya existe y tiene datos**. Un `terraform apply` en frío
intentaría crearlo y fallaría con `BucketAlreadyOwnedByYou`, o peor, si alguien
"arregla" eso con un `force_destroy` se lleva por delante los adjuntos de
conversaciones reales. Por eso todo el plan gira alrededor de `terraform import`.

### Paso 0 — Inventariar el servidor real (no se toca nada)

Lo que el repositorio no puede decir hay que preguntárselo al servidor. Con las
credenciales root, en modo lectura:

```bash
export MC="docker run --rm -e MC_HOST_t=https://$MINIO_ROOT_USER:$MINIO_ROOT_PASSWORD@$MINIO_ENDPOINT minio/mc"
$MC ls t/                                    # ¿qué buckets hay de verdad?
$MC ls --recursive t/dermicapro-media | head # ¿qué prefijos hay de verdad?
$MC admin user list t
$MC admin policy list t
$MC admin policy info t dermicapro-app-policy
$MC version info t/dermicapro-media
$MC ilm rule ls t/dermicapro-media
$MC anonymous get t/dermicapro-media
```

Hay que anotar: nombre exacto del bucket, si el prefijo `dermicapro/` está
realmente poblado con las cuatro categorías, si el usuario se llama
`dermicapro-app` o el operador cambió `MINIO_APP_USER`, y si ya existe alguna
service account colgando del usuario.

**Salida esperada según el repo**: un bucket, un usuario, una política, sin
versionado, sin ILM, acceso anónimo denegado. Cualquier divergencia se resuelve
aquí, antes de escribir el primer `import`.

**Comprobación adicional en el servidor de la app**: si `backend/.env` tiene
`MEDIA_STORAGE_BACKEND=local` (que es el valor de `.env.example:75`), el bucket
puede estar vacío y todo el multimedia estar viviendo dentro del contenedor.
Eso cambia el orden: el paso 1 pasa a ser urgente.

### Paso 1 — Cortar la pérdida de datos (independiente de Terraform)

Es la acción 3 de `docs/analisis/00-plan-de-mejoras.md:59` y **no espera a
Terraform**. Dos caminos:

- **Inmediato y de una línea**: montar un volumen nombrado en `compose.prod.yml`
  para `/app/media` (la ruta de `MEDIA_DIR`, `media_storage.py:26`), con el
  mismo criterio de nombre explícito que `dermicapro-pgdata`
  (`compose.db.yml:97-102`). Sobrevive al blue-green porque el volumen no
  pertenece al proyecto de color.
- **Definitivo**: `MEDIA_STORAGE_BACKEND=minio` en `backend/.env`, tras correr
  `python migrate_media_to_minio.py --report media-migration-report.json`, que
  sube los archivos verificando sha256 y **sin borrar los originales**
  (`migrate_media_to_minio.py:1-7`, `:60-76`).

Hacer los dos, en ese orden: el volumen es la red de seguridad mientras se migra.

Verificación: `GET /health/ready` sigue en 200 y `check_media_storage()`
(`media_storage.py:511-525`) devuelve `{"backend": "minio", "status": "ok"}`.
Reversión: volver `MEDIA_STORAGE_BACKEND=local` y recrear el backend; los
originales siguen en disco porque el migrador no borra nada.

### Paso 2 — Crear el bucket de estado (una sola vez, a mano)

Es el arranque en frío de la sección 3.4: no lo puede crear el Terraform que lo
va a usar.

```bash
$MC mb t/dermicapro-tfstate
$MC version enable t/dermicapro-tfstate    # la red de seguridad ante un estado corrupto
$MC anonymous set none t/dermicapro-tfstate
```

Este paso no toca nada de la aplicación.

### Paso 3 — Escribir el código con backend local

`terraform init` **sin** el backend remoto todavía. El objetivo es equivocarse
en local, donde `rm terraform.tfstate` deshace cualquier cosa.

```bash
cd infra/terraform/envs/prod
export TF_VAR_minio_admin_user=... TF_VAR_minio_admin_password=...
terraform init
terraform validate
```

### Paso 4 — Importar lo que ya existe

**Nunca `apply` antes del `import`.** El orden importa: primero el bucket,
después la política, después el usuario y su vínculo.

```bash
terraform import module.media.minio_s3_bucket.media dermicapro-media
terraform import module.media.minio_iam_policy.media_rw dermicapro-app-policy
terraform import module.media.minio_iam_user.app dermicapro-app
terraform import module.media.minio_iam_user_policy_attachment.app dermicapro-app/dermicapro-app-policy
```

> **Formato de ID a verificar.** El ID del bucket, de la política y del usuario
> es su nombre; de eso no hay duda. El del *attachment* (`usuario/politica`)
> **no lo puedo confirmar** y varía entre providers. Si el import falla, la
> alternativa es no importarlo: eliminar el vínculo con
> `$MC admin policy detach t dermicapro-app-policy --user dermicapro-app` y
> dejar que Terraform lo cree. Es la única operación de este paso con impacto:
> **entre el detach y el apply la aplicación pierde permisos**, así que se hace
> en una ventana corta y se verifica inmediatamente.

**Lo que NO se importa: las service accounts.** MinIO **no devuelve el secreto**
de una service account existente; importarla dejaría un `secret_key` vacío en el
estado y un output inservible. Se crean nuevas (paso 6) y la credencial vieja se
retira sólo cuando la nueva ya esté funcionando.

**Tampoco se importa el versionado ni el ILM**: hoy no existen, así que son
recursos a crear, no a importar.

### Paso 5 — El plan tiene que salir limpio

```bash
terraform plan
```

Lo que se espera: **cero cambios** sobre bucket, política y usuario, y sólo
altas de lo nuevo (versionado, ILM, identidad de sólo lectura, service
accounts).

Si el plan quiere **modificar** la política, hay que mirar el diff carácter a
carácter: normalmente es reordenación del array `Action` o un `Sid` distinto, y
se arregla igualando el `jsonencode` de `policies.tf` a lo que devuelve
`$MC admin policy info`. **Si el plan quiere destruir y recrear el bucket, se
para todo**: significa que un atributo inmutable (nombre, región, object
locking) no coincide, y aplicarlo se lleva los datos.

Criterio de salida del paso: `terraform plan` sin ninguna línea `- destroy` ni
`-/+ replace`.

### Paso 6 — Aplicar sólo lo aditivo

```bash
terraform apply
```

Crea: `minio_s3_bucket_versioning`, `minio_ilm_policy`, el usuario y la política
de sólo lectura, y las dos service accounts. Ninguno de esos recursos afecta a
la credencial que la aplicación está usando en ese momento, así que **el
servicio no se entera**.

Verificación:

```bash
$MC version info t/dermicapro-media       # Enabled
$MC ilm rule ls t/dermicapro-media        # la regla de versiones no actuales
$MC admin user list t                     # dermicapro-app y dermicapro-ro
```

Y sobre la app, sin tocarla: subir un archivo desde la biblioteca (`POST
/api/media/upload`, `routers/media.py:193`), verlo, y comprobar que
`$MC ls --recursive t/dermicapro-media/dermicapro/` lo muestra en su categoría.

Reversión: `terraform destroy -target=...` de cada recurso nuevo. El versionado
es la excepción — sólo se puede pasar a `Suspended`, no revertir (4.4).

### Paso 7 — Rotar la credencial de la aplicación

El único paso con riesgo real. Hoy la app usa la credencial del **usuario**
`dermicapro-app`; se la pasa a la **service account** creada en el paso 6.

Con blue-green esto sale sin corte, aprovechando exactamente el mecanismo que ya
existe (`scripts/deploy-bluegreen.sh`, `compose.bluegreen.yml:5-8`):

1. Poner `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` nuevos en `backend/.env`
   (`terraform output -raw app_access_key` / `app_secret_key`).
2. Desplegar. El color nuevo arranca con la credencial nueva; el que sirve sigue
   con la vieja, que **todavía es válida** porque nadie la ha borrado.
3. El health check del color nuevo valida el acceso, porque
   `/health/ready` acaba llamando a `check_media_storage()`, que hace
   `bucket_exists` con la credencial configurada (`media_storage.py:519-525`).
   Si la credencial nueva no sirve, el color no pasa la verificación y
   `deploy-bluegreen.sh` **no conmuta el tráfico**: no hay que revertir nada.
4. Conmutado el tráfico y verificado, invalidar el secreto viejo del usuario
   padre. Aquí es donde `update_secret = false` (4.6) evita que Terraform lo
   haga por su cuenta en un momento inoportuno.

Reversión: volver los valores anteriores en `backend/.env` y desplegar. La
credencial vieja sigue viva hasta el punto 4, que es deliberadamente el último.

### Paso 8 — Mover el estado a MinIO

Con todo funcionando y el estado ya correcto:

```bash
cp terraform.tfstate terraform.tfstate.backup-preflight   # fuera del repo
terraform init -backend-config=backend.hcl -migrate-state
terraform plan     # debe seguir saliendo vacío
```

Que el `plan` posterior a la migración salga vacío es la comprobación de que el
estado viajó entero. Reversión: `terraform init -migrate-state` de vuelta a
local usando la copia.

### Paso 9 — Retirar `scripts/minio-setup.sh`

No se borra: se le añade una cabecera que diga que **queda sustituido por
`infra/terraform/`** y que ejecutarlo ahora es destructivo respecto al estado de
Terraform, porque borra y recrea política y usuario
(`scripts/minio-setup.sh:139`, `:144`). Se conserva porque documenta la
justificación de cada permiso (`:55-66`), que es información que no conviene
perder.

### Resumen del riesgo por paso

| Paso | Toca producción | Reversible | Downtime |
|---|---|---|---|
| 0 inventario | no | — | no |
| 1 volumen/migración | sí | sí | no (recreación del backend) |
| 2 bucket de estado | no | sí | no |
| 3 código | no | — | no |
| 4 import | no (salvo el detach) | sí | no, si el attachment importa bien |
| 5 plan | no | — | no |
| 6 apply aditivo | sí | parcialmente (versionado no) | no |
| 7 rotación | sí | sí | no, vía blue-green |
| 8 estado remoto | no | sí | no |
| 9 documentación | no | sí | no |

## 6. Integración en CI/CD

### 6.1 Workflow aparte, no dentro de `ci-cd.yml`

`.github/workflows/ci-cd.yml` tiene hoy cuatro jobs (`frontend-checks`,
`backend-checks`, `docker-build-check` y `deploy`), y `deploy` depende de los
tres primeros (`:84`). Meter Terraform ahí acoplaría el despliegue de la
aplicación a la disponibilidad de MinIO: un `plan` que falla porque el servidor
está caído bloquearía un despliegue de frontend que no tiene nada que ver.

Va en `.github/workflows/infra-terraform.yml`, con filtro por rutas, que además
es lo que hace que no se ejecute en los cientos de PR que no tocan infra.

### 6.2 Requisito previo: ¿llega el runner al endpoint?

Antes de escribir nada hay que responder a esto. El endpoint documentado es
`minio-api.tudominio.com:9000` (`backend/.env.example:76`), es decir, un nombre
público. **Si es alcanzable desde Internet, los runners de GitHub valen.**

Si en cambio está detrás de la red privada, hay dos opciones:

- **Runner autoalojado** en la VPS de la aplicación, que es la que ya alcanza
  todo. Es coherente con `docs/red-privada-wireguard.md` y con que el despliegue
  actual entre por SSH a esa misma máquina (`ci-cd.yml:88-96`).
- **Aplicar sólo desde la máquina del operador**, y dejar en CI únicamente
  `fmt`, `validate` y `tflint`, que no necesitan hablar con MinIO. Es la opción
  honesta si no se quiere abrir el puerto ni montar un runner.

El repositorio no permite determinar cuál es el caso: no hay nada que documente
la topología de red de MinIO.

### 6.3 El workflow

```yaml
name: Infra Terraform (MinIO)

on:
  pull_request:
    branches: [main]
    paths: ["infra/terraform/**"]
  push:
    branches: [main]
    paths: ["infra/terraform/**"]

# El backend s3 sobre MinIO puede quedarse sin bloqueo si la versión de
# Terraform no soporta use_lockfile (ver 3.4). Esto serializa el workflow
# para que dos ejecuciones no escriban el mismo estado.
concurrency:
  group: terraform-minio-prod
  cancel-in-progress: false

permissions:
  contents: read
  pull-requests: write   # sólo para publicar el plan como comentario

jobs:
  plan:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: infra/terraform/envs/prod
    env:
      # Credencial del bucket de estado. Distinta de la de administración:
      # sólo necesita leer y escribir en dermicapro-tfstate.
      AWS_ACCESS_KEY_ID: ${{ secrets.TFSTATE_ACCESS_KEY }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.TFSTATE_SECRET_KEY }}
      # Credencial de administración de MinIO. NO es la root (ver 6.4).
      TF_VAR_minio_admin_user: ${{ secrets.MINIO_TF_USER }}
      TF_VAR_minio_admin_password: ${{ secrets.MINIO_TF_PASSWORD }}
      TF_IN_AUTOMATION: "true"
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
        with:
          # Fijada, con el mismo criterio que traefik 3.7.9 y postgres 16.10.
          terraform_version: "1.9.8"

      # fmt y validate van primero y no necesitan red: si el código está mal
      # escrito, se sabe sin haber hablado con MinIO.
      - run: terraform fmt -check -recursive ../..
      - run: terraform init -backend-config=backend.hcl
      - run: terraform validate

      - name: Plan
        id: plan
        run: terraform plan -no-color -input=false -lock-timeout=5m -out=tfplan
      - name: Publicar el plan en el PR
        if: github.event_name == 'pull_request'
        uses: actions/github-script@v7
        with:
          script: |
            const plan = `${{ steps.plan.outputs.stdout }}`.slice(0, 60000);
            await github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: "```terraform\n" + plan + "\n```",
            });

      # Guardarraíl explícito. Un plan que destruye recursos en este stack
      # significa que se lleva por delante el bucket con los adjuntos de
      # conversaciones, o la credencial que la aplicación está usando ahora
      # mismo. Se para y se revisa a mano.
      - name: Rechazar planes destructivos
        run: |
          terraform show -no-color tfplan > plan.txt
          if grep -qE '^\s*[-]/?\+? .*(destroy|must be replaced)' plan.txt; then
            echo "ERROR: el plan destruye o reemplaza recursos." >&2
            echo "Revisar a mano antes de aplicar; ver seccion 5, paso 5." >&2
            exit 1
          fi

      - uses: actions/upload-artifact@v4
        with:
          name: tfplan
          path: infra/terraform/envs/prod/tfplan
          retention-days: 5

  apply:
    needs: [plan]
    if: github.ref == 'refs/heads/main' && github.event_name == 'push'
    runs-on: ubuntu-latest
    # Environment protegido: requiere aprobación manual de un revisor
    # configurado en Settings > Environments. Es lo que convierte "se mergeó
    # a main" en "alguien decidió tocar produccion".
    environment: minio-prod
    defaults:
      run:
        working-directory: infra/terraform/envs/prod
    env:
      AWS_ACCESS_KEY_ID: ${{ secrets.TFSTATE_ACCESS_KEY }}
      AWS_SECRET_ACCESS_KEY: ${{ secrets.TFSTATE_SECRET_KEY }}
      TF_VAR_minio_admin_user: ${{ secrets.MINIO_TF_USER }}
      TF_VAR_minio_admin_password: ${{ secrets.MINIO_TF_PASSWORD }}
      TF_IN_AUTOMATION: "true"
    steps:
      - uses: actions/checkout@v4
      - uses: hashicorp/setup-terraform@v3
        with:
          terraform_version: "1.9.8"
      - uses: actions/download-artifact@v4
        with:
          name: tfplan
          path: infra/terraform/envs/prod
      - run: terraform init -backend-config=backend.hcl
      # Se aplica EL PLAN REVISADO, no uno nuevo. Un `terraform apply` sin
      # fichero recalcula el plan y aplica algo que nadie leyó.
      - run: terraform apply -input=false -lock-timeout=5m tfplan
```

### 6.4 Permisos mínimos

**Tres credenciales distintas, ninguna es la root de MinIO:**

| Credencial | Para qué | Ámbito |
|---|---|---|
| `MINIO_TF_USER` / `MINIO_TF_PASSWORD` | Que Terraform administre buckets e identidades | Un usuario de MinIO con política de administración, **no** el root |
| `TFSTATE_ACCESS_KEY` / `TFSTATE_SECRET_KEY` | Leer y escribir el estado | Sólo `arn:aws:s3:::dermicapro-tfstate/*` |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` de la app | Runtime del backend | Sólo `arn:aws:s3:::dermicapro-media/dermicapro/*` (ya acotada, `minio-setup.sh:70`) |

El usuario de Terraform necesita administrar políticas y usuarios, lo que en
MinIO se acerca a `consoleAdmin`. Se puede acotar denegando explícitamente lo
que no debe poder hacer:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": ["admin:*", "s3:*"], "Resource": ["arn:aws:s3:::*"] },
    {
      "Sid": "NoTocarElEstado",
      "Effect": "Deny",
      "Action": ["s3:*"],
      "Resource": ["arn:aws:s3:::dermicapro-tfstate", "arn:aws:s3:::dermicapro-tfstate/*"]
    },
    {
      "Sid": "NoBorrarObjetosDeMedia",
      "Effect": "Deny",
      "Action": ["s3:DeleteObject", "s3:DeleteBucket"],
      "Resource": ["arn:aws:s3:::dermicapro-media", "arn:aws:s3:::dermicapro-media/*"]
    }
  ]
}
```

El segundo `Deny` es el importante: **impide por construcción que un plan mal
revisado se lleve los datos**, con independencia de lo que diga el HCL. Es el
mismo principio que aplica hoy la política de la aplicación al acotarse al
prefijo en vez de al bucket entero.

> A verificar contra la versión de MinIO: la sintaxis de las acciones `admin:*`
> es específica de MinIO (no existe en AWS) y el conjunto exacto varía entre
> versiones. Si el `Deny` sobre `s3:DeleteBucket` impidiera algún `apply`
> legítimo, se afloja **esa** acción, nunca el `Deny` sobre `DeleteObject`.

**Permisos del workflow.** `permissions: contents: read` por defecto y
`pull-requests: write` sólo en el job de plan, para el comentario. El job de
`apply` no necesita escribir nada en GitHub.

### 6.5 Qué NO debe hacer el pipeline

- **No escribir `backend/.env`.** La correspondencia de la sección 4.12 la
  ejecuta el operador. Un pipeline con permiso para editar el `.env` de
  producción necesita SSH a producción, y eso es exactamente lo que el
  environment protegido intenta acotar.
- **No imprimir outputs sensibles.** `terraform output` sin `-raw` los enmascara,
  pero el `plan` en texto plano puede filtrar valores nuevos de recursos
  sensibles. Por eso el comentario del PR se recorta y por eso el artefacto
  `tfplan` tiene `retention-days: 5`: **un fichero de plan contiene datos
  sensibles en claro**, igual que el estado.
- **No aplicar en `dev` automáticamente sin revisión.** Aunque `dev` tenga
  `force_destroy = true` (4.11), un apply automático sobre un entorno con
  `force_destroy` es la forma más rápida de borrar un bucket por accidente.

## 7. Riesgos, trampas y fuera de alcance

### 7.1 Riesgos ordenados por lo que cuesta si ocurren

| # | Riesgo | Por qué es real aquí | Mitigación |
|---|---|---|---|
| R1 | **Terraform destruye el bucket con datos** | El bucket existe con adjuntos de conversaciones de pacientes, referenciados desde `media_assets.media_url`. Un `apply` sin `import` previo, o un cambio en un atributo inmutable, lo replantea como replace | `force_destroy = false` en prod (4.3), `import` antes de cualquier `apply` (paso 4), guardarraíl anti-destrucción en CI (6.3) y `Deny` de `DeleteBucket`/`DeleteObject` en la política del usuario de Terraform (6.4) |
| R2 | **Se rota la credencial y la app se queda sin acceso** | Hoy `scripts/minio-setup.sh:144-146` ya hace eso: borra el usuario y lo recrea, invalidando el secreto en uso | `update_secret = false` (4.6), service account separada del usuario, y rotación por blue-green con `/health/ready` como puerta (paso 7) |
| R3 | **Los secretos quedan en claro en el estado** | Es comportamiento de Terraform, no un fallo | Bucket de estado propio y privado, credencial dedicada, `.gitignore`, outputs `sensitive` (3.5). Aceptado explícitamente |
| R4 | **`media_prefix` y `MINIO_PREFIX` divergen** | La política se acota al prefijo; si la app escribe fuera, falla con `AccessDenied` en subidas pero **las lecturas antiguas siguen bien**, así que se descubre tarde | Comprobación en despliegue (4.12), del mismo estilo que la de `DATABASE_SSL` en `ci-cd.yml:130-135` |
| R5 | **Versionado sin lifecycle: el bucket crece sin techo** | Cada sobrescritura deja una copia permanente. Como la app reescribe por nombre estable, es un caso real | ILM obligatorio junto al versionado (4.7); `versioning_enabled` y la regla comparten el mismo `count` |
| R6 | **MinIO caído ⇒ no se puede ni planificar** | El estado vive en el mismo MinIO que se administra (3.4) | Aceptado. Copia local del estado antes de operaciones grandes (paso 8) |
| R7 | **Estado sin bloqueo** | El backend `s3` contra MinIO no tiene DynamoDB; `use_lockfile` depende de la versión | `concurrency` en el workflow (6.3) y un único operador |
| R8 | **El provider no está a la altura** | Es un provider comunitario, con cambios de atributos entre versiones mayores | Versión fijada, `.terraform.lock.hcl` commiteado, y la opción B del provider de AWS como salida (3.2) |
| R9 | **El runner no alcanza el endpoint** | El repo no documenta la topología de red de MinIO | Decidido en 6.2 antes de escribir el workflow |

### 7.2 Trampas específicas de MinIO con Terraform

Cosas que en AWS funcionan y aquí no, o al revés:

1. **`s3_use_path_style` es obligatorio.** MinIO no resuelve
   `bucket.host/objeto`, sólo `host/bucket/objeto`. Sin esta opción, el provider
   de AWS resuelve un DNS que no existe y el error (`no such host`) no apunta a
   la causa.
2. **No hay STS, ni IAM de AWS, ni metadata de EC2.** De ahí los cuatro `skip_*`
   de 3.2 y 4.2. Sin ellos, el provider intenta validar la cuenta contra AWS de
   verdad y el plan se cuelga o falla con un error de credenciales que nada
   tiene que ver con MinIO.
3. **`region` es decorativa pero obligatoria.** MinIO acepta cualquiera; el
   proyecto usa `us-east-1` (`backend/config.py:55`). Cambiarla después obliga a
   reconfigurar el backend de estado.
4. **Las service accounts no devuelven su secreto.** Consecuencia directa: **no
   se pueden importar de forma útil** (paso 4) y no hay forma de "recuperar" un
   secreto perdido; sólo rotarlo.
5. **`mc admin policy` opera sobre políticas con nombre, no sobre políticas de
   bucket.** Son dos cosas distintas que en AWS también lo son pero que aquí se
   confunden fácil: `minio_iam_policy` (política con nombre, adjuntable a
   usuarios; es la que usa `minio-setup.sh:140`) frente a
   `minio_s3_bucket_policy` (política *del bucket*, tipo acceso anónimo, que
   aquí equivale a `mc anonymous`). Adjuntar una donde va la otra produce
   permisos que parecen aplicados y no lo están.
6. **Reordenar el array `Action` genera diff perpetuo.** MinIO puede devolver la
   política normalizada en otro orden que el `jsonencode` local. Si `plan` nunca
   converge, hay que igualar el orden a lo que devuelve
   `mc admin policy info`.
7. **El versionado no se puede desactivar**, sólo suspender (4.4). Y con
   versionado activo, un `DeleteObject` crea un *delete marker*: el
   `remove_object` de `delete_media` (`media_storage.py:496-508`) deja de
   liberar espacio de inmediato. La regla ILM es lo que lo compensa.
8. **`ListBucket` a nivel de bucket es imprescindible.** `check_media_storage()`
   llama a `bucket_exists` (`media_storage.py:520`), que necesita permisos sobre
   `arn:aws:s3:::$BUCKET` y no sobre los objetos. Una política que sólo cubra
   `$BUCKET/$PREFIX/*` deja `/health/ready` fallando aunque las subidas y
   descargas funcionen.
9. **Las acciones de multipart no son opcionales.** Ya lo advierte el script
   (`minio-setup.sh:60-63`): sin ellas suben las imágenes pequeñas y fallan los
   vídeos, de forma intermitente.
10. **`AbortIncompleteMultipartUpload` puede no estar expuesto por el
    provider.** Alternativa por `mc` documentada en 4.7.
11. **El bucket de estado no debe entrar en el ámbito de ninguna política de la
    aplicación.** Es fácil que ocurra si alguien "simplifica" la política a
    `arn:aws:s3:::*`.
12. **`terraform destroy` en `dev` con `force_destroy = true` no avisa dos
    veces.** Y si alguien copia el `envs/dev/main.tf` a `prod` como plantilla, se
    lleva ese `true`. Por eso el default de la variable es `false` (4.3): el
    descuido tiene que ser explícito.

### 7.3 Fuera de alcance de este plan

Ya justificado en la sección 2, se recopila aquí para que no haya dudas:

- **El servidor MinIO**: instalación, actualización, disco, TLS, publicación
  detrás de Traefik, y su ubicación de red. No está en el repositorio y este
  plan no lo trae.
- **Las credenciales root de MinIO**: se consumen, no se crean.
- **`backend/.env`**: lo sigue escribiendo el operador.
- **La migración de datos**: la hace `backend/migrate_media_to_minio.py`.
- **El volumen de media del blue-green**: es un cambio en `compose.prod.yml`,
  no un recurso de Terraform (paso 1 de la sección 5).
- **El timeout del cliente MinIO** (`media_storage.py:143-150`): es un cambio de
  código Python, acción 4 de `docs/analisis/00-plan-de-mejoras.md:60`.
- **Notificaciones de bucket**: dependen de configuración del servidor (2.3).
- **URLs presignadas**: la app sirve por proxy autenticado
  (`routers/media.py:161-191`) y cambiarlo es una decisión de arquitectura, no
  de infraestructura.
- **Terraform para PostgreSQL, Traefik, WireGuard o los propios contenedores.**
  El repositorio ya los gestiona con compose y scripts, y mezclarlos ahora
  multiplicaría el alcance sin resolver el problema que abrió este documento.
- **Multi-tenant.** El pivote descrito en `docs/multi-tenant-saas-plan.md`
  cambiará probablemente la estructura de claves (hoy plana bajo
  `{prefijo}/{categoria}/`, `media_storage.py:92-95`) para incluir la
  organización. Cuando eso ocurra habrá que revisar el ámbito de la política y
  decidir entre bucket por tenant o prefijo por tenant. **Este plan no lo
  anticipa**, deliberadamente: hacerlo obligaría a diseñar sobre un esquema de
  claves que todavía no existe.

### 7.4 Datos que este plan no pudo determinar desde el repositorio

Para que quede constancia y se pregunten antes de ejecutar:

1. Dónde corre el servidor MinIO y si es alcanzable desde los runners de GitHub.
2. Si `backend/.env` en producción tiene hoy `MEDIA_STORAGE_BACKEND=local` o
   `minio` (el `.env` no está commiteado, `.gitignore:2`).
3. El nombre real del bucket y del usuario en el servidor: el repo sólo tiene
   los valores de ejemplo (`dermicapro-media`) y el default del script
   (`dermicapro-app`).
4. La versión exacta del provider `aminueza/minio` publicada y sus atributos
   (3.2), el formato de ID de `minio_iam_user_policy_attachment` (paso 4), y si
   `minio_ilm_policy` expone el aborto de multipart (4.7).
5. La versión de Terraform que se instalará, de la que depende el soporte de
   `use_lockfile` (3.4).
