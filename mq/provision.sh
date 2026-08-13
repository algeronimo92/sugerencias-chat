#!/bin/sh
# Usuarios y permisos del broker. Se ejecuta DENTRO del contenedor:
#
#   docker compose -f compose.mq.yml --env-file mq/.env exec rabbitmq /mq/provision.sh
#
# Es idempotente: se puede volver a correr cuando se rota una contraseña o se
# ajusta un permiso.
#
# Por qué no está en definitions.json, que sería lo natural: ese archivo pide
# el hash de la contraseña de cada usuario, y un hash en el repo sigue siendo
# material sensible. La topología (exchanges, colas, bindings) sí vive allí,
# que es la parte que interesa poder reconstruir desde git.
set -eu

VHOST="${RABBITMQ_VHOST:-dermicapro}"
ADMIN="${RABBITMQ_ADMIN_USER:?falta RABBITMQ_ADMIN_USER}"

: "${RABBITMQ_EVOLUTION_PASSWORD:?falta RABBITMQ_EVOLUTION_PASSWORD}"
: "${RABBITMQ_N8N_PASSWORD:?falta RABBITMQ_N8N_PASSWORD}"

# La contraseña del administrador llega como RABBITMQ_DEFAULT_PASS porque ese
# es el nombre con el que compose.mq.yml se la pasa al broker; acá se reusa esa
# misma variable en vez de pedir una nueva, para que no haya dos fuentes de la
# verdad para la misma credencial.
: "${RABBITMQ_DEFAULT_PASS:?falta RABBITMQ_DEFAULT_PASS}"

echo "Esperando a que el nodo responda..."

# `await_startup` NO alcanza por sí solo, y esto se pagó en un despliegue.
#
# Ese comando espera a que un nodo que YA ESTÁ CORRIENDO termine de
# inicializarse. Si el proceso Erlang todavía no existe —el caso normal
# inmediatamente después de un `up -d --force-recreate`, que devuelve el control
# en ~3 s mientras el broker tarda bastante más— falla en el acto con
# "node 'rabbit' not running at all" y, con `set -e`, se lleva puesto el script
# entero antes de tocar un solo permiso. En CI eso queda en un AVISO que nadie
# lee y el broker se queda con la configuración vieja.
#
# 60 intentos por 2 s = 2 min de margen, holgado contra el `start_period: 60s`
# del healthcheck de compose.mq.yml.
intento=0
until rabbitmqctl await_startup 2>/dev/null; do
  intento=$((intento + 1))
  if [ "$intento" -ge 60 ]; then
    echo "ERROR: el nodo no respondió en 2 minutos. Diagnóstico:" >&2
    # Sin silenciar, para que el motivo real quede en el log del despliegue.
    rabbitmqctl await_startup
    exit 1
  fi
  sleep 2
done

# Que rabbitmq.conf se haya cargado DE VERDAD.
#
# Desde que el archivo vive en /mq y no en la ruta por defecto, quien los une es
# RABBITMQ_CONFIG_FILE. Si esa variable falta, el broker arranca perfecto y en
# silencio con todos los valores por defecto: sin `load_definitions` (colas y
# bindings sin declarar) y con el límite de disco en 50 MB. Todo parece bien
# hasta el día en que hace falta.
#
# Se comprueba el efecto y no el formato de ningún comando: `disk_free_limit` es
# el ajuste que más se aleja del default (2 GB contra 50 MB), así que sirve de
# huella de que el archivo se leyó. En rabbitmq.conf hay una nota recíproca.
#
# Se aceptan las dos formas porque RabbitMQ guarda el valor TAL CUAL viene del
# archivo y sólo lo resuelve a bytes cuando lo va a usar: con `2GB` escrito en
# rabbitmq.conf, esto devuelve `{ok,"2GB"}` y no `{ok,2000000000}`. Comparar
# sólo contra el número daba un falso positivo de "configuración perdida" sobre
# un broker perfectamente configurado. El default, que es lo que hay que
# detectar, es `{ok,50000000}`: no coincide con ninguna de las dos.
limite=$(rabbitmqctl eval 'application:get_env(rabbit, disk_free_limit).' 2>&1)
case "$limite" in
  *2GB*|*2000000000*) ;;
  *)
    echo "ERROR: rabbitmq.conf no se cargó (disk_free_limit = $limite)." >&2
    echo "Revisar RABBITMQ_CONFIG_FILE en compose.mq.yml y el montaje de ./mq." >&2
    exit 1
    ;;
esac

# `add_user` falla si el usuario ya existe; `change_password` es lo que hace
# que volver a correr el script sirva para rotar la credencial.
crear_usuario() {
  usuario="$1"
  clave="$2"
  # Sin tags por defecto: ni evolution ni n8n entran a la consola de
  # administración. Sólo el admin recibe `administrator`.
  tags="${3:-}"
  if rabbitmqctl list_users --formatter json | grep -q "\"$usuario\""; then
    echo "  usuario $usuario: ya existe, se actualiza la contraseña"
    rabbitmqctl change_password "$usuario" "$clave"
  else
    echo "  usuario $usuario: creado"
    rabbitmqctl add_user "$usuario" "$clave"
  fi
  # Sin comillas a propósito: con tags vacío no se pasa ningún argumento.
  rabbitmqctl set_user_tags "$usuario" $tags
}

echo "Vhost $VHOST"
rabbitmqctl add_vhost "$VHOST" 2>/dev/null || echo "  ya existía"

echo "Usuarios"

# El administrador se crea ACÁ y no vía RABBITMQ_DEFAULT_USER, aunque esa
# variable esté puesta en compose.mq.yml.
#
# Motivo: RABBITMQ_DEFAULT_USER sólo siembra el usuario cuando el nodo arranca
# con la base virgen Y no hay definiciones que importar. Como rabbitmq.conf usa
# `load_definitions`, RabbitMQ importa definitions.json y da la base por
# inicializada, así que el usuario por defecto NO se crea nunca. Y como en
# definitions.json `users` va vacío a propósito (ese archivo pediría el hash de
# la contraseña, y un hash en el repo sigue siendo material sensible), el
# broker terminaba sin un solo administrador: la consola quedaba inaccesible y
# este script fallaba en el set_permissions del final con "User admin does not
# exist". Pasaba en toda instalación desde cero, no sólo en la primera.
crear_usuario "$ADMIN" "$RABBITMQ_DEFAULT_PASS" administrator

crear_usuario evolution "$RABBITMQ_EVOLUTION_PASSWORD"
crear_usuario n8n "$RABBITMQ_N8N_PASSWORD"

echo "Plugin de métricas"

# La imagen oficial trae rabbitmq_prometheus activado, pero de eso depende la
# única alerta que avisa de una DLQ llena, así que se afirma en vez de darse
# por hecho: `enable` es idempotente y no reinicia el nodo. Sin el plugin,
# Prometheus scrapea el 15692 en vacío, `up` queda en 0 y lo que dispara es
# RabbitMQCaido — molesto pero honesto, no un silencio.
rabbitmq-plugins enable --quiet rabbitmq_prometheus

echo "Permisos (configure / write / read)"

# Evolution API: publica en un exchange y declara sus colas por evento.
#
# Requiere que el .env de Evolution diga:
#
#   RABBITMQ_EXCHANGE_NAME=evolution_exchange   (antes decía `evolution`)
#   RABBITMQ_GLOBAL_ENABLED=true
#
# Y un tercer ajuste que NO es variable de entorno, sino un setting de la
# instancia que se cambia por la API: `groupsIgnore` tiene que estar en `true`.
# Sin eso entran eventos de grupos de WhatsApp, que el pipeline no sabe
# representar (no hay lead al que colgarlos) y terminan todos en q.wsp.dlq.
# Pasó el 2026-08-12 con 92 mensajes. El detalle está en
# docs/rabbitmq-ingesta-n8n-plan.md, sección "Evolution API".
#
# El modo global tiene que quedarse en `true`, y esto se pagó con una caída de
# la ingesta el 2026-08-12. Apagarlo NO es "dejá de crear las colas huérfanas":
# el modo global es "un exchange compartido, el tenant en el campo `instance`
# del evento", así que apagarlo cambia A DÓNDE PUBLICA Evolution. Los mensajes
# dejan de pasar por `evolution_exchange`, `q.wsp.inbound` no recibe nada y no
# se cae nada — simplemente no entra un solo WhatsApp.
#
# O sea: las colas `evolution.*` son inseparables del modo global en esta
# versión. No se quitan desde el origen; se contienen con la política de más
# abajo, que para eso está.
#
# Si Evolution deja de publicar, el síntoma es "no entran mensajes" con todo
# verde: registra el error de permisos y sigue vivo, no se cae.
#
# El `read` acotado al exchange (y NO vacío) es a propósito, y cuesta un poco de
# explicar. En RabbitMQ, atar una cola a un exchange (`queue.bind`) exige
# permiso `read` SOBRE EL EXCHANGE de origen, no sólo `write` sobre la cola. Con
# el `^$` que había antes, Evolution conectaba y autenticaba bien, declaraba el
# exchange y sus colas, y recién ahí moría con:
#
#   ACCESS_REFUSED - read access to exchange 'evolution_exchange'
#   in vhost 'dermicapro' refused for user 'evolution'
#
# y entraba en un bucle de reconexión cada 5 s sin publicar un solo mensaje.
#
# Lo importante es que esto NO le da la capacidad de leer conversaciones:
# `read` sobre una COLA es lo que habilita consumir, y ninguna cola matchea
# `^evolution_exchange$`. Si la credencial se filtra, sigue sin poder sacar un
# mensaje de q.wsp.inbound.
#
# Antes acá había `.*` en configure y write, porque no estaba confirmado con
# qué nombres declara sus colas. Ya se sabe: `evolution.<evento>`
# (evolution.messages.upsert, evolution.send.message, evolution.messages.update),
# y son quorum queues. Eso permite acotar los dos patrones sin romper nada.
#
# `read` sí queda en el exchange solo: es lo que necesita para atar sus colas
# (queue.bind pide read sobre el exchange de origen) y no le da acceso a
# ninguna COLA, que es lo que habilitaría consumir conversaciones ajenas.
#
# OJO con acotar `read` a un solo nombre: mientras el .env de Evolution siga
# diciendo `evolution` en vez de `evolution_exchange`, este patrón le impide
# atar sus colas y deja de publicar. Es exactamente lo que cortó la ingesta el
# 2026-08-12. Los dos lados tienen que decir lo mismo.
rabbitmqctl set_permissions -p "$VHOST" evolution \
  '^(evolution_exchange|evolution\..*)$' \
  '^(evolution_exchange|evolution\..*)$' \
  '^evolution_exchange$'

# n8n: consume las dos colas de entrada y publica en los exchanges del reintento.
#
# Los nombres de `configure` son exactamente los que el nodo de n8n declara al
# conectarse (assertQueue / assertExchange). Si se le quita el permiso, el nodo
# falla al arrancar; si se le da de más, puede redeclarar algo con otros
# argumentos. Esta lista es la mínima que funciona.
#
# `q.wsp.status` (acuses de entrega y lectura, evento MESSAGES_UPDATE) sólo
# necesita configure y read: su workflow no reintenta por cola, así que no
# publica en ningún lado.
#
# Fijarse en que NO tiene permiso sobre ninguna de las colas de reintento ni
# sobre la DLQ: publica en los exchanges wsp.retry, wsp.retry.slow y wsp.dead,
# y son ellos los que enrutan. Ese rodeo es a propósito — así n8n nunca declara
# una cola que lleva argumentos (TTL, dead-letter) y no puede provocar un
# PRECONDITION_FAILED al redeclararla con otros distintos.
rabbitmqctl set_permissions -p "$VHOST" n8n \
  '^(q\.wsp\.inbound|q\.wsp\.status|wsp\.retry|wsp\.retry\.slow|wsp\.dead)$' \
  '^(wsp\.retry|wsp\.retry\.slow|wsp\.dead)$' \
  '^(q\.wsp\.inbound|q\.wsp\.status)$'

# El administrador sí necesita verlo todo, si no la consola aparece vacía.
rabbitmqctl set_permissions -p "$VHOST" "$ADMIN" '.*' '.*' '.*'

# Las colas `evolution.*` NO se borran acá, aunque nadie las consuma.
#
# Se intentó y fue un error de diagnóstico: son inseparables del modo global
# (ver el comentario de los permisos de evolution, arriba), así que Evolution
# las vuelve a declarar en cuanto reconecta. Borrarlas en cada despliegue es
# churn que además tira la copia cruda reciente de los payloads, que es
# justamente lo único que esas colas aportan.
#
# Quien las mantiene a raya es la política de abajo. Si algún día hay que
# vaciarlas a mano, el comando es `rabbitmqctl delete_queue -p dermicapro
# <cola>` SIN `--if-unused`: son quorum queues, y RabbitMQ rechaza esa bandera
# sobre ese tipo de cola tenga o no consumidores.

echo "Políticas"

# Esta política ES el mecanismo, no un respaldo: las colas huérfanas no se
# pueden apagar en el origen sin mover a dónde publica Evolution.
#
# En modo global declara una cola por evento
# (`evolution.messages.upsert`, `evolution.send.message`) atada a su exchange, y
# recibe en ellas una copia de todo. Nadie las consume: la ingesta real va por
# q.wsp.inbound, que está atada al mismo exchange con sus propios bindings.
#
# Sin esta política crecen sin techo. Y no terminan en "una cola grande": cuando
# el disco baja de `disk_free_limit.absolute` (2 GB, ver rabbitmq.conf) RabbitMQ
# BLOQUEA A TODOS LOS PUBLICADORES del nodo. Evolution deja de poder publicar y
# ahí sí se pierden mensajes de WhatsApp — el fallo exacto que este servicio
# vino a evitar, provocado por el propio servicio.
#
# Una hora de TTL las mantiene casi vacías y de paso deja una copia cruda
# reciente por si hiciera falta mirar un payload original. `max-length` cubre
# la ráfaga que no daría tiempo a expirar.
#
# Va acá y no en definitions.json a propósito: ese archivo sólo se lee al
# arrancar el nodo, y una política tiene que poder aplicarse sin reiniciar un
# broker que está sirviendo. Este script corre en cada despliegue, así que
# converge solo.
#
rabbitmqctl set_policy -p "$VHOST" \
  evolution-huerfanas '^evolution\.' \
  '{"message-ttl":3600000,"max-length":10000,"overflow":"drop-head"}' \
  --apply-to queues --priority 0

# `guest` no debería existir (RABBITMQ_DEFAULT_USER evita que se cree), pero si
# el volumen viene de un arranque anterior sin esa variable, sigue ahí. Su
# restricción a loopback no protege acá: el loopback del contenedor es
# alcanzable desde cualquier servicio de la red `data`.
if rabbitmqctl list_users --formatter json | grep -q '"guest"'; then
  echo "Borrando el usuario guest"
  rabbitmqctl delete_user guest
fi

echo
echo "Estado:"
rabbitmqctl list_permissions -p "$VHOST"
echo
rabbitmqctl list_policies -p "$VHOST"
echo
# `messages` en las colas evolution.* debe quedarse cerca de cero. Si crece
# despacio y no baja, la política no está agarrando: revisar el patrón contra
# el nombre real con `rabbitmqctl list_queues -p dermicapro name policy`.
rabbitmqctl list_queues -p "$VHOST" name messages consumers policy
