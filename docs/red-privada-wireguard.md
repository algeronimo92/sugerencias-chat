# Red privada entre las VPS con WireGuard

## Por qué

n8n corre en una VPS y PostgreSQL en otra.
Hostinger **no ofrece red privada entre VPS** — no aparece en hPanel ni está
documentado en su base de conocimientos —, así que n8n no tiene forma de llegar
a la base sin salir a Internet.

Publicar PostgreSQL en la IP pública es la opción evidente y la mala: por ahí
viajarían las credenciales y el contenido de las conversaciones de pacientes en
claro. Es exactamente el hallazgo que abrió la auditoría de este proyecto.

WireGuard crea la red privada que el proveedor no da. Cifra de extremo a
extremo, así que **no hace falta configurar TLS en PostgreSQL**, y permite que
la base escuche únicamente en la interfaz del túnel: deja de ser alcanzable
desde Internet incluso si alguien abre el puerto por error.

## Direcciones

| Máquina | IP en el túnel |
|---|---|
| App + PostgreSQL | `10.10.0.1` |
| n8n | `10.10.0.2` |

Las IP públicas no se escriben aquí: el repositorio es público y no conviene
dejar la topología del servidor en él. Sustituir `<IP-PUBLICA-APP>` y
`<IP-PUBLICA-N8N>` por las reales al aplicar la configuración.

## 1. Instalar y generar claves (en las dos)

```bash
apt update && apt install -y wireguard
cd /etc/wireguard
umask 077
wg genkey | tee privada.key | wg pubkey > publica.key
cat publica.key    # anotar: cada máquina necesita la PÚBLICA de la otra
```

La clave privada nunca sale de su máquina.

## 2. Configuración

**En la VPS de la app** (`/etc/wireguard/wg0.conf`):

```ini
[Interface]
Address = 10.10.0.1/24
ListenPort = 51820
PrivateKey = <privada.key de ESTA máquina>

[Peer]
PublicKey = <publica.key de la VPS de n8n>
AllowedIPs = 10.10.0.2/32
PersistentKeepalive = 25
```

**En la VPS de n8n**:

```ini
[Interface]
Address = 10.10.0.2/24
PrivateKey = <privada.key de ESTA máquina>

[Peer]
PublicKey = <publica.key de la VPS de la app>
Endpoint = <IP-PUBLICA-APP>:51820
AllowedIPs = 10.10.0.1/32
PersistentKeepalive = 25
```

`AllowedIPs` limitado a la IP concreta del otro extremo, no `0.0.0.0/0`: sólo
se enruta por el túnel lo que va a esa máquina, no todo el tráfico de la VPS.

`PersistentKeepalive` mantiene viva la sesión a través del NAT; sin él, el lado
que no inicia la conexión deja de ser alcanzable tras unos minutos de silencio.

## 3. Levantar

```bash
systemctl enable --now wg-quick@wg0
wg show          # debe listar el peer y, tras el primer paquete, un handshake
```

En el **firewall de Hostinger de la VPS de la app**, permitir el puerto del
túnel y sólo desde el otro extremo:

```
Accept  UDP  51820  origen <IP-PUBLICA-N8N>
```

No hace falta abrir el 5432 en ningún firewall: va por dentro del túnel.

## 4. Comprobar

```bash
# desde la VPS de n8n
ping -c 3 10.10.0.1
```

## 5. Apuntar PostgreSQL al túnel

En `db/.env` de la VPS de la app:

```
POSTGRES_BIND_IP=10.10.0.1
```

```bash
docker compose -f compose.db.yml --env-file db/.env up -d
docker ps --filter name=postgres --format '{{.Ports}}'   # 10.10.0.1:5432->5432/tcp
```

Que muestre `10.10.0.1` y no `0.0.0.0` es la comprobación que importa: significa
que la base sólo atiende por el túnel.

Desde la VPS de n8n:

```bash
nc -zv 10.10.0.1 5432
```

## 6. El nodo de PostgreSQL en n8n

| Campo | Valor |
|---|---|
| Host | `10.10.0.1` |
| Port | `5432` |
| Database | `dermicapro_db` |
| User | `dermicapro` |
| Password | la de `db/.env` |
| SSL | `disable` — el túnel ya cifra |

n8n corre en Docker Swarm; sus contenedores alcanzan `10.10.0.1` por el
enrutado del host, sin configuración extra.

## Alternativa si no se quiere WireGuard

Publicar PostgreSQL en la IP pública **exige** entonces:

1. TLS en PostgreSQL (`ssl = on` y certificado en `postgresql.conf`)
2. `DATABASE_SSL=require` en la aplicación y `SSL: require` en el nodo de n8n
3. Regla de firewall para el 5432 con origen la IP de n8n **únicamente**

Es más trabajo que el túnel y deja el puerto expuesto a Internet, aunque
filtrado. WireGuard es preferible.
