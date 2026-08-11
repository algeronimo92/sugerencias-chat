#!/bin/sh
# Usuarios y permisos del broker. Se ejecuta DENTRO del contenedor:
#
#   docker compose -f compose.mq.yml --env-file mq/.env exec rabbitmq /provision.sh
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
rabbitmqctl await_startup

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

echo "Permisos (configure / write / read)"

# Evolution API: publica y nada más.
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
# Lo importante es que esto NO le devuelve la capacidad de leer conversaciones:
# `read` sobre una COLA es lo que habilita consumir, y ninguna cola matchea
# `^evolution_exchange$`. Si la credencial se filtra, sigue sin poder sacar un
# mensaje de q.wsp.inbound.
#
# El `configure`/`write` abiertos son deliberadamente amplios EN ESTA PRIMERA
# ETAPA: en modo global Evolution declara por su cuenta el exchange y una cola
# por evento, y todavía no está confirmado con qué nombres exactos. Denegarlo
# antes de saberlo produce un fallo silencioso (Evolution registra el error y
# deja de publicar) que cuesta caro diagnosticar.
#
# Para cerrarlo, después del primer día de tráfico:
#   rabbitmqctl list_queues -p dermicapro name
#   rabbitmqctl list_exchanges -p dermicapro name
# y reemplazar los dos '.*' por un '^(evolution_exchange|<lo que aparezca>)$'.
# Los DOS nombres de exchange: `evolution_exchange` es el default de la imagen y
# el que declara definitions.json; `evolution` es el que quedó configurado en el
# .env de Evolution en producción (RABBITMQ_EXCHANGE_NAME). q.wsp.inbound está
# atada a los dos, así que el flujo funciona con cualquiera de las dos config.
# Cuando se unifique el nombre en el .env de Evolution, sacar el que sobre de
# acá y de definitions.json.
rabbitmqctl set_permissions -p "$VHOST" evolution '.*' '.*' '^(evolution|evolution_exchange)$'

# n8n: consume la cola de entrada y publica en los dos exchanges del reintento.
#
# Los tres nombres de `configure` son exactamente los que el nodo de n8n
# declara al conectarse (assertQueue / assertExchange). Si se le quita el
# permiso, el nodo falla al arrancar; si se le da de más, puede redeclarar algo
# con otros argumentos. Esta lista es la mínima que funciona.
#
# Fijarse en que NO tiene permiso sobre ninguna de las colas de reintento ni
# sobre la DLQ: publica en los exchanges wsp.retry, wsp.retry.slow y wsp.dead,
# y son ellos los que enrutan. Ese rodeo es a propósito — así n8n nunca declara
# una cola que lleva argumentos (TTL, dead-letter) y no puede provocar un
# PRECONDITION_FAILED al redeclararla con otros distintos.
rabbitmqctl set_permissions -p "$VHOST" n8n \
  '^(q\.wsp\.inbound|wsp\.retry|wsp\.retry\.slow|wsp\.dead)$' \
  '^(wsp\.retry|wsp\.retry\.slow|wsp\.dead)$' \
  '^q\.wsp\.inbound$'

# El administrador sí necesita verlo todo, si no la consola aparece vacía.
rabbitmqctl set_permissions -p "$VHOST" "$ADMIN" '.*' '.*' '.*'

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
rabbitmqctl list_queues -p "$VHOST" name messages consumers
