# Ingesta de WhatsApp por RabbitMQ, con n8n como consumidor

Estado: **desplegado**. Los pasos manuales están al final; las secciones 5 y 6 de
"Las decisiones que importan" salieron de lo que falló al ponerlo en producción.

## Qué resuelve

Hoy Evolution API llama por HTTP al workflow `Webhooks evolution` de n8n, que
delega en `rag`, que normaliza, analiza con Gemini, inserta en `wsp_messages` y
avisa al backend.

El nodo Webhook de ese workflow no tiene `responseMode` configurado, así que usa
el valor por defecto: **responde 200 al recibir, antes de procesar**. Evolution
da el evento por entregado y no reintenta nunca. Si n8n está caído, el workflow
desactivado o el `Call 'rag'` revienta a mitad, el mensaje se perdió y del lado
de Evolution todo salió bien. No hay reintento en ninguna capa.

Con este cambio Evolution publica en una cola durable. Si n8n no está, los
mensajes esperan. Si el workflow falla, se reintenta con espera. Si sigue
fallando, queda en una cola muerta para reprocesar a mano.

Lo que **no** cambia: n8n sigue siendo quien decide si un mensaje existe. Un bug
de lógica del workflow sigue costando el mensaje, sólo que ahora queda guardado
en la DLQ en vez de evaporarse.

## Arquitectura

```text
Evolution API
   │ publica (usuario `evolution`, sólo write)
   ▼
evolution_exchange  (topic)
   │  rk: messages.upsert , send.message
   ▼
q.wsp.inbound  ◄───────────────────────────────────────┐
   │ consume (usuario `n8n`)                            │
   ▼                                                    │
Workflow "Webhooks evolution"                           │
   ├─ ¿agotó reintentos? ─sí─> wsp.dead ──> q.wsp.dlq   │  (queda ahí)
   └─ no ─> Call 'rag' ─┬─ ok ─────────────> ack        │  (fin)
                        │                               │
                        └─ error ─> ¿backoff largo?     │
                                       │                │
              intentos 0,1  ───────────┤                │
                        ▼              │                │
                  wsp.retry            │                │
                        ▼              │                │
              q.wsp.retry.30s          │                │
              x-message-ttl: 30000 ────┼──> wsp.return ─┤
                                       │                │
              intentos 2..5  ──────────┘                │
                        ▼                               │
                 wsp.retry.slow                         │
                        ▼                               │
              q.wsp.retry.15m                           │
              x-message-ttl: 900000 ─────> wsp.return ──┘
```

`rag` queda como ingesta pura y llama al workflow `analista` sin esperarlo.

## Las decisiones que importan

### 1. El debounce del analista sale del camino del ack

Es el motivo por el que este cambio no era un simple cambio de trigger.

`rag` tenía el nodo `debounce analista1` (Wait) **en el camino principal**, y el
padre lo llamaba con `waitForSubWorkflow: true`. La ejecución no terminaba hasta
pasar la espera y correr el agente analista entero. Un consumidor de RabbitMQ
sólo puede ackear cuando su ejecución termina, así que el mensaje habría quedado
sin ackear todo ese rato: el broker cierra el canal por `consumer_timeout` (30
min) y reencola, y mientras tanto cada mensaje ocupa un lugar del prefetch.

Ahora son dos workflows. `rag` termina en el INSERT y el aviso al backend —
segundos, determinista, reintentable— y dispara `analista` con
`waitForSubWorkflow: false`. Ahí sí está bien no esperar: si el analista falla,
el mensaje ya está guardado y visible; sólo se pierde una pasada del agente.

> **Pendiente de verificar**: el nodo `debounce analista1` es `{"amount": 15}`
> **sin el campo `unit`**, o sea que usa la unidad por defecto del nodo Wait, que
> no es segundos. Se movió tal cual, sin tocarlo, para no cambiar el
> comportamiento junto con la estructura. Hay que abrirlo en la UI y confirmar
> qué unidad está aplicando.

### 2. El reintento no depende del `nack` de n8n

El error más común al montar esto es asumir que un `nack` es un reintento. No lo
es: el mensaje vuelve **a la cabeza de la cola** y se reconsume de inmediato, sin
espera y sin contador. Un fallo determinista —Gemini caído, la base caída— se
convierte en un bucle a máxima velocidad que quema créditos y nunca llega a la
DLQ.

Además, qué hace exactamente el trigger de n8n al fallar (¿`requeue` sí o no?)
cambia entre versiones, y de eso dependería que la escalera de colas funcione.

Así que no se depende de eso. `Call 'rag'` tiene `onError: continueErrorOutput`:
un fallo **no** tumba la ejecución, sale por la segunda salida y nosotros mismos
republicamos el mensaje en el exchange de reintento que corresponda. La
ejecución termina bien, el original se ackea, y la copia vuelve sola a
`q.wsp.inbound` cuando vence el TTL de la cola donde cayó.

El contador de intentos viaja **dentro del cuerpo**, en `_reintentos`, y no en
los headers AMQP. Es a propósito: no depende de que `x-death` se propague igual
en cada versión del broker ni de que el nodo exponga los headers. `rag` ignora
las claves que no conoce, así que el campo extra es inocuo. El precio es que el
payload deja de ser byte a byte el que mandó Evolution, cosa que importaría si
algún día se archivan los crudos.

**La escalera es de dos escalones**, y no de uno, porque una sola espera no
sirve para los dos fallos que existen:

| Intento | Espera | Acumulado |
|---|---|---|
| 0, 1 | 30 s | 1 min |
| 2, 3, 4, 5 | 15 min | 61 min |
| 6 | — | a la DLQ |

Con un solo escalón de 30 s hay que elegir mal por fuerza: 5 intentos cubren
dos minutos y medio, así que una caída de la base de diez minutos quema los
cinco y vacía la cola entera en la DLQ. Subir el escalón a 15 min arreglaría
eso pero haría que un tropiezo de un segundo —un timeout suelto de Gemini—
costara un cuarto de hora de latencia en el chat del vendedor.

Con dos escalones, un tropiezo se resuelve en 30 segundos y una caída tiene una
hora para volver.

> Lo que esto **no** hace es distinguir por tipo de error. Un bug determinista
> del workflow también tarda la hora entera en llegar a la DLQ; simplemente
> falla seis veces. Distinguirlos exigiría clasificar el mensaje de error del
> nodo por texto (`ECONNREFUSED` y compañía), que se rompe con cada cambio de
> versión o de idioma. Y no hace falta: un bug determinista va a seguir estando
> dentro de una hora, y la DLQ es sólo dónde estaciona.

### 3. n8n publica en exchanges, nunca en colas

Las colas de reintento y la DLQ llevan argumentos (`x-message-ttl`,
`x-dead-letter-exchange`, `x-max-length`). El nodo de n8n **declara** lo que
toca al conectarse, y si declara una cola existente con argumentos distintos,
RabbitMQ responde `PRECONDITION_FAILED` (406) y el nodo deja de funcionar.

Por eso los tres nodos de publicación apuntan a exchanges —`wsp.retry`,
`wsp.retry.slow` y `wsp.dead`, los tres fanout, durables y sin argumentos—:
contra eso el assert coincide siempre. Y por eso **`q.wsp.inbound` se declara sin ningún argumento**, aunque
tendría sentido darle un dead-letter-exchange: es la única cola que n8n declara
directamente, y cualquier argumento ahí es un 406 esperando a pasar.

Los permisos de `mq/provision.sh` refuerzan lo mismo: el usuario `n8n` no tiene
`configure` sobre ninguna de las colas con argumentos, así que ni por error
puede redeclararlas.

### 4. Las colas huérfanas de Evolution tienen TTL

En modo global Evolution declara sus propias colas por evento y les manda una
copia de todo. La ingesta real no pasa por ahí —`q.wsp.inbound` está atada al
mismo exchange con sus propios bindings— así que quedan sin consumidor.

Sin límite, eso no termina en "una cola grande". Termina en que el disco baja de
`disk_free_limit.absolute` y RabbitMQ **bloquea a todos los publicadores del
nodo**: Evolution deja de poder publicar y se pierden mensajes de WhatsApp. El
servicio que se montó para no perder mensajes sería el que los pierde.

La política `evolution-huerfanas` (`^evolution\.`, `apply-to: queues`) les pone
una hora de TTL y un tope de 10 000 mensajes. Una hora y no diez minutos porque
de paso deja una copia cruda reciente por si hace falta mirar un payload
original.

Vive en `mq/provision.sh` y no en `definitions.json` a propósito: ese archivo
sólo se lee al arrancar el nodo, y una política tiene que poder aplicarse sin
reiniciar un broker que está sirviendo. El script corre en cada despliegue, así
que converge solo.

El patrón no toca ninguna cola nuestra: todas empiezan por `q.wsp.`.

### 5. La carpeta `mq/` se monta entera, no archivo por archivo

Parece un detalle de compose y es la causa del incidente más caro que tuvo esta
ingesta hasta ahora.

Docker resuelve el bind mount de un **archivo suelto** por inodo, fijado al
crear el contenedor. `git pull` no edita en sitio: escribe el archivo nuevo al
lado y lo renombra encima, con otro inodo. El contenedor sigue apuntando al
inodo viejo —ya desenlazado del árbol, invisible para `ls`— y sirve para siempre
la versión anterior. Y como `up -d` es idempotente y no recrea nada mientras
`compose.mq.yml` no cambie, el arreglo del repo no llega nunca.

Fue exactamente lo que pasó: el `read` de `evolution` seguía en `^$` dentro del
contenedor con el repo ya corregido y `provision.sh` corriendo en cada
despliegue —imprimiendo `Setting permissions for user "evolution"` sin que el
permiso cambiara—, mientras Evolution reintentaba cada 5 s en un bucle de
`ACCESS_REFUSED` sin publicar un solo mensaje de WhatsApp.

Cómo se reconoce, si vuelve a pasar con cualquier otro archivo montado así:

```bash
md5sum mq/provision.sh
docker compose -f compose.mq.yml --env-file mq/.env exec rabbitmq md5sum /mq/provision.sh
```

El bind mount de un **directorio** resuelve cada nombre al abrirlo, así que el
renombrado de git se ve enseguida. De ahí que hoy vaya `./mq:/mq:ro`, que
`rabbitmq.conf` viva en `/mq/rabbitmq.conf` con `RABBITMQ_CONFIG_FILE`
apuntándole, y que el script se ejecute como `/mq/provision.sh`.

Quedan dos cabos, atados en el mismo cambio:

- **Recrear cuando toque.** `rabbitmq.conf` y `definitions.json` sólo se leen al
  arrancar el nodo. `ci-cd.yml` ya detectaba si cambió algo de `mq/`, pero sólo
  lo imprimía; ahora eso agrega `--force-recreate`.
- **Que la configuración se haya cargado.** Con el archivo fuera de su ruta por
  defecto, un `RABBITMQ_CONFIG_FILE` mal puesto deja al broker arrancando
  perfecto y en silencio con todos los valores por defecto: sin
  `load_definitions` y con el límite de disco en 50 MB. `provision.sh` lo
  comprueba al empezar, leyendo `disk_free_limit` del nodo y comparándolo con
  los 2 GB del archivo.

### 6. `provision.sh` espera a que el nodo exista, no sólo a que esté listo

`rabbitmqctl await_startup` espera a que un nodo **que ya corre** termine de
inicializarse. Recién recreado el contenedor no corre todavía: `up -d` devuelve
el control en unos segundos y el broker tarda bastante más. En ese hueco
`await_startup` falla en el acto con `node 'rabbit' not running at all` y, con
`set -e`, se lleva el script entero antes de tocar un permiso — dejando en CI un
AVISO que nadie lee y el broker con la configuración vieja. Por eso el
`await_startup` va dentro de un bucle de 60 intentos por 2 s.

## Archivos

| Archivo | Qué es |
|---|---|
| [compose.mq.yml](../compose.mq.yml) | El broker. Proyecto de compose propio, red `dermicapro-data` |
| [mq/rabbitmq.conf](../mq/rabbitmq.conf) | `consumer_timeout`, límite de disco, carga de definiciones |
| [mq/definitions.json](../mq/definitions.json) | Topología: 5 exchanges, 4 colas, 6 bindings |
| [mq/provision.sh](../mq/provision.sh) | Usuarios y permisos. Idempotente |
| [mq/.env.example](../mq/.env.example) | Plantilla de `mq/.env` |
| `webhooks-evolution-rabbitmq.json` | Workflow padre nuevo (raíz, no versionado) |
| `rag-ingesta.json` | `rag` sin el analista (raíz, no versionado) |
| `analista.json` | Workflow del analista (raíz, no versionado) |

Los tres JSON de n8n **no se versionan**: traen la apikey de Evolution y el token
de webhook en claro. `.gitignore` pasó a listarlos por patrón — antes iban por
nombre exacto y `rag (5).json` y `Webhooks evolution (1).json` habían quedado
fuera de la lista, a un `git add -A` de subir esas credenciales al repo.

## Qué cambió en cada workflow

**`Webhooks evolution`** (3 nodos → 10):

- `RabbitMQ Trigger` sobre `q.wsp.inbound`, ack sólo si la ejecución termina bien.
- `contar intentos` (Code): normaliza el mensaje AMQP a la **misma forma que
  producía el nodo Webhook** (`{headers, params, query, body}`), de modo que
  `rag` no cambia ni una expresión — allí todo se lee como `$json.body.*`.
- `agotó reintentos` (IF) → `a la DLQ` o `Call 'rag'`.
- `Call 'rag'` con `onError: continueErrorOutput` → `backoff largo` → uno de
  los dos nodos de reencolado.
- Los dos nodos Webhook quedan **desactivados**, como camino de rollback, y con
  `headerAuth` puesto: estaban completamente abiertos, y `evolution/messages-upsert`
  termina insertando en `wsp_messages`. Al reactivarlos hay que configurar el
  header en Evolution, o rebotan con 403.
- Se corrigió que los dos compartían el mismo `webhookId` por copiar el nodo.

**`rag`** (90 nodos → 74):

- Salen los 18 nodos del analista.
- Entran `datos para el analista` (Set con `chat_id`, `message_id`,
  `last_sender` — los tres únicos campos que el analista leía de `chat input`) y
  `Call analista` con `waitForSubWorkflow: false`.
- `Webhook4` (`mensajes-wsp`) pasa a `headerAuth`. Era un POST público que
  escribía en la base. **Si algo externo lo llama hoy, se va a romper**: no hay
  ningún llamador dentro del repo, pero conviene mirar los logs de n8n antes.

**`analista`** (nuevo, 19 nodos):

- Los 18 nodos movidos, sin cambios de lógica.
- Un `Execute Workflow Trigger` llamado `Datos del mensaje`. Las seis
  expresiones que decían `$('chat input')` ahora dicen `$('Datos del mensaje')`.

## Credenciales

No se sacan de ningún lado: **se inventan acá**. El broker todavía no existe, así
que las tres contraseñas son secretos nuevos. La única fuente de verdad es
`mq/.env`, que no se versiona; todo lo demás copia de ahí.

```bash
openssl rand -hex 24
```

Hex y no base64 a propósito: la contraseña de `evolution` viaja **dentro de una
URI AMQP** (`RABBITMQ_URI`), y un `/`, `@`, `:` o `?` la partiría en dos. Con hex
no hay nada que escapar.

| Quién | Variable en `mq/.env` | Dónde más se pega |
|---|---|---|
| `admin` | `RABBITMQ_ADMIN_PASSWORD` | En ningún lado. Sólo para entrar a la consola por túnel SSH |
| `evolution` | `RABBITMQ_EVOLUTION_PASSWORD` | En el `.env` de Evolution API, dentro de `RABBITMQ_URI` |
| `n8n` | `RABBITMQ_N8N_PASSWORD` | En la credencial RabbitMQ de n8n |

Los usuarios no existen hasta que corre `mq/provision.sh`, que los crea leyendo
esas variables. Para rotar una, se cambia en `mq/.env`, se vuelve a correr el
script (es idempotente) y se actualiza el otro extremo.

### La credencial de n8n

Los cuatro nodos de RabbitMQ del workflow padre se importan **sin credencial
asignada**: un export de n8n sólo lleva el id y el nombre de la credencial, no su
contenido, y acá no había ninguna que referenciar. Hay que crearla una vez y
seleccionarla en los cuatro (`RabbitMQ Trigger`, `a la DLQ`, `reintentar en
30 s`, `reintentar en 15 min`).

En n8n, *Credentials → New → RabbitMQ*:

| Campo | Valor |
|---|---|
| Hostname | `10.8.0.1` (la IP del túnel, no el dominio) |
| Port | `5672` |
| User | `n8n` |
| Password | el valor de `RABBITMQ_N8N_PASSWORD` |
| Vhost | `dermicapro` — **sin barra delante** |
| SSL | desactivado |

Sobre el vhost: en RabbitMQ el nombre es una cadena cualquiera, y el vhost por
defecto se llama literalmente `/`. Si se lo llamara `/dermicapro`, en una URI
habría que escribirlo `%2Fdermicapro`, porque la barra separa el host del vhost.
Se llama `dermicapro` justamente para no arrastrar ese escape a tres archivos
distintos.

Sobre SSL: va desactivado porque el tramo n8n → broker es el túnel WireGuard, que
ya cifra. Si algún día ese tráfico saliera por Internet, hay que habilitar TLS en
RabbitMQ antes, no sólo tildar la casilla — si no, las credenciales y el
contenido de los mensajes viajan en claro.

## Puesta en marcha

### 1. Broker

Lo despliega el pipeline junto con el resto (`ci-cd.yml`), **pero sólo si
`mq/.env` existe en el servidor**. Ese archivo no viaja por git, así que hay que
crearlo a mano una vez, en la VPS de la app:

```bash
cd <ruta del proyecto en el servidor>
cp mq/.env.example mq/.env
nano mq/.env          # las tres contraseñas
```

A partir de ahí, cada push a `main` corre `up -d` y `provision.sh` solo. Si
`mq/.env` no está, el despliegue **no falla**: avisa en el log y sigue con la
aplicación. Es deliberado — que la ingesta por cola no esté configurada no es
razón para dejar la app sin desplegar.

Para levantarlo a mano la primera vez, sin esperar un push:

```bash
docker compose -f compose.mq.yml --env-file mq/.env up -d
docker compose -f compose.mq.yml --env-file mq/.env exec rabbitmq /mq/provision.sh
```

Comprobar que el puerto quedó donde debe — esto es lo que importa, no que el
contenedor esté arriba:

```bash
docker ps --filter name=rabbitmq --format '{{.Ports}}'   # 10.8.0.1:5672 y 127.0.0.1:15672
```

Que muestre `10.8.0.1` y no `0.0.0.0` es la comprobación que importa.

Consola por túnel SSH, nunca por Traefik:

```bash
ssh -L 15672:127.0.0.1:15672 usuario@servidor
```

### 2. Evolution API

Variables a poner (los nombres exactos hay que confirmarlos contra la versión
desplegada, ver la lista de pendientes):

```
RABBITMQ_ENABLED=true
RABBITMQ_URI=amqp://evolution:<clave>@10.8.0.1:5672/dermicapro
RABBITMQ_EXCHANGE_NAME=evolution_exchange
RABBITMQ_GLOBAL_ENABLED=true
RABBITMQ_EVENTS_MESSAGES_UPSERT=true
RABBITMQ_EVENTS_SEND_MESSAGE=true
```

Dejar los webhooks HTTP **apagados** en el mismo cambio. Si se dejan los dos
caminos activos, cada mensaje se procesa dos veces: el guard
`buscar mensaje existente1` evita el doble INSERT, pero no el doble análisis de
Gemini, que se paga.

### 3. n8n

Credencial RabbitMQ: host `10.8.0.1`, puerto `5672`, usuario `n8n`, vhost
`dermicapro`.

Importar en este orden, porque cada uno necesita el id del anterior:

1. `analista.json`. Copiar el id del workflow de la URL.
2. `rag-ingesta.json`. En el nodo `Call analista`, reemplazar
   `REEMPLAZAR-POR-EL-ID-DE-analista` eligiendo `analista` en el desplegable.
3. `webhooks-evolution-rabbitmq.json`. En `Call 'rag'`, apuntar al `rag` correcto.

**Antes de activar, abrir el nodo `RabbitMQ Trigger` y confirmar tres cosas.**
Están escritas en el JSON, pero si el nombre interno de alguna opción cambió
entre versiones, n8n la ignora en silencio y aplica su valor por defecto:

| Opción | Valor | Por qué |
|---|---|---|
| Delete From Queue When | Execution Finishes **Successfully** | El default es *Immediately*: ackea antes de procesar y pierde el mensaje ante cualquier fallo. Es peor que hoy. |
| Parallel Message Processing Limit | 1 | Con más de uno, dos mensajes del mismo chat se procesan a la vez y las automatizaciones se disparan fuera de orden. |
| Only Content | desactivado | El Code espera `{content: ...}`; igual está escrito para tolerar las dos formas. |

Lo mismo con los tres nodos de publicación: confirmar que quedaron en modo
**Exchange** (`wsp.retry`, `wsp.retry.slow` y `wsp.dead`, los tres fanout) y no
en modo Queue.

### 4. Prueba de humo

Con el trigger activo y Evolution publicando:

```bash
# el mensaje entra y se consume
docker compose -f compose.mq.yml --env-file mq/.env exec rabbitmq \
  rabbitmqctl list_queues -p dermicapro name messages consumers
```

`q.wsp.inbound` debe tener `consumers = 1` y `messages = 0` en reposo.

Para probar el reintento sin romper nada: desactivar el workflow `rag`. El
`Call 'rag'` falla, el mensaje aparece en `q.wsp.retry.30s` y 30 s después
vuelve a `q.wsp.inbound`. Al tercer fallo pasa a `q.wsp.retry.15m`; si se quiere
ver el final sin esperar una hora, bajar temporalmente el `x-message-ttl` de esa
cola. Tras 6 fallos termina en `q.wsp.dlq`. Reactivar `rag`
y reinyectar desde la consola (Get messages → Requeue no sirve; hay que
publicarlo de nuevo en `evolution_exchange` con la routing key original).

## Pendiente

- **La alerta de DLQ.** Decidido a propósito dejarla fuera de esta tanda. La
  forma recomendada es una regla de Prometheus sobre la profundidad de
  `q.wsp.dlq` (`rabbitmq_queue_messages{queue="q.wsp.dlq"} > 0`) usando el
  Alertmanager que ya está montado, y **no** un workflow que consuma la DLQ y
  mande un WhatsApp por mensaje: con la base caída llegan cientos. Si la alerta
  sale por WhatsApp, tiene que ir por Evolution directo y no por el CRM — el caso
  más probable de DLQ llena es justamente que el CRM esté caído.
  Requiere habilitar el plugin `rabbitmq_prometheus` y publicar el 15692.
- **Confirmar la unidad de `debounce analista1`** (arriba).
- **Confirmar los nombres de las variables de Evolution** y que la versión
  desplegada soporta modo global. La carpeta `docs/evolution-api-2.3-mensajes/`
  sugiere 2.3; conviene mirarlo en el contenedor.
- **Confirmar que Evolution declara `evolution_exchange` como `topic` durable.**
  Si lo declara distinto, choca con `mq/definitions.json` y hay que ajustar el
  archivo, no Evolution.
- **Cerrar los permisos de `evolution`.** Hoy tiene `configure`/`write` sobre
  `.*` porque todavía no se sabe qué nombres declara por su cuenta en modo
  global. `read` ya está en `^$`, que es lo que protege las conversaciones. El
  procedimiento para cerrarlo está en `mq/provision.sh`.
- **Apagar las colas que Evolution crea por su cuenta.** En modo global declara
  una cola por evento (`evolution.messages.upsert`, `evolution.send.message`) y
  recibe en ellas una copia de todo; nadie las consume. Ya hay una política que
  las mantiene a raya (abajo), pero lo definitivo es que Evolution no las cree.

## Relación con el otro plan

[rabbitmq-eventos-plan.md](rabbitmq-eventos-plan.md) propone algo distinto y más
grande: que el **backend** consuma la cola y persista, dejando a n8n sólo el
análisis IA. Este plan no lo contradice, lo antecede: `evolution_exchange` es un
topic exchange, así que el día que se quiera probar aquello se agrega
`q.crm.inbound` con otro binding al mismo exchange y los dos consumidores corren
en paralelo para comparar. Eso es exactamente el "modo sombra" de la fase 3 de
aquel documento, y sale casi gratis por haber dejado el exchange bien puesto acá.

[analisis/07-analisis-mensajeria.md](analisis/07-analisis-mensajeria.md)
recomienda en su §7.1 no meter ningún broker de colas. Ese análisis mira el
outbox, las automatizaciones y el fan-out de WebSocket — todo interno, todo con
PostgreSQL como fuente de verdad — y su conclusión sigue en pie para eso. La
ingesta desde Evolution no está en su diagnóstico: da por hecho que "n8n ya lo
insertó". Sus propias señales de escalado (§7.2) apuntan acá: *"eventos que no se
pueden perder cruzando procesos — aparece el primero"*. Y donde dice que la
primera opción a evaluar sería NATS y no RabbitMQ, la respuesta es que Evolution
publica en RabbitMQ de forma nativa y n8n tiene nodo trigger; con NATS habría que
escribir las dos puntas.
