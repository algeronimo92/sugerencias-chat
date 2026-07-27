"""Mide la latencia real hacia PostgreSQL desde donde se ejecute.

Separa las tres cosas que se confunden en una sola medición:

- resolución DNS (se paga una vez y el sistema la cachea);
- handshake TCP (se paga al abrir conexión, y el pool lo amortiza);
- roundtrip de consulta (se paga en CADA consulta — este es el que importa).

Un endpoint que hace N consultas paga N veces el tercer número. Ese es el
piso de latencia de la aplicación, y ninguna optimización de frontend,
índice o caché lo baja.

Uso, desde el VPS y contra el contenedor de producción:

    docker compose -f compose.prod.yml exec -T backend python < backend/scripts/db_latency.py

Se pasa por stdin para no pelear con el escapado de comillas. No escribe
nada: solo SELECT 1 y lecturas de catálogo. No imprime credenciales.
"""

import asyncio
import os
import socket
import statistics
import time
from urllib.parse import urlsplit

import asyncpg

PROBES = 10


def _percentile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    index = min(int(len(ordered) * fraction), len(ordered) - 1)
    return ordered[index]


def _report(label: str, samples: list[float]) -> None:
    print(
        f"  {label:<26} mediana {statistics.median(samples):>7.1f} ms"
        f"   min {min(samples):>7.1f} ms   p90 {_percentile(samples, 0.9):>7.1f} ms"
    )


async def main() -> None:
    raw_url = os.environ.get("DATABASE_URL")
    if not raw_url:
        raise SystemExit("DATABASE_URL no está definida en este entorno")
    url = raw_url.replace("postgresql+asyncpg://", "postgresql://", 1)

    parts = urlsplit(url)
    host, port = parts.hostname, parts.port or 5432

    # Sirve para distinguir si esto corrió dentro del contenedor del backend
    # o en una máquina de escritorio: el número solo vale desde producción.
    print(f"Ejecutando en: {socket.gethostname()}  (cwd={os.getcwd()})")
    print(f"Destino: {host}:{port}\n")

    started = time.perf_counter()
    ip = await asyncio.to_thread(socket.gethostbyname, host)
    print(f"DNS: {(time.perf_counter() - started) * 1000:.1f} ms  ->  {ip}\n")

    print("Handshake TCP (lo amortiza el pool de conexiones):")
    tcp = []
    for _ in range(5):
        started = time.perf_counter()
        sock = await asyncio.to_thread(socket.create_connection, (ip, port), 10)
        tcp.append((time.perf_counter() - started) * 1000)
        sock.close()
    _report("connect()", tcp)

    connection = await asyncpg.connect(url, ssl=os.environ.get("DATABASE_SSL", "prefer"))
    try:
        encrypted = await connection.fetchval(
            "SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()"
        )
        print(f"\nCifrado TLS: {'sí' if encrypted else 'NO (tráfico en claro)'}\n")

        print("Roundtrip por consulta (este es el piso de cada endpoint):")
        for label, query in (
            ("SELECT 1", "SELECT 1"),
            ("COUNT(*) wsp_messages", "SELECT count(*) FROM wsp_messages"),
        ):
            samples = []
            for _ in range(PROBES):
                started = time.perf_counter()
                await connection.fetchval(query)
                samples.append((time.perf_counter() - started) * 1000)
            _report(label, samples)

        floor = statistics.median(
            [await _timed(connection, "SELECT 1") for _ in range(PROBES)]
        )
    finally:
        await connection.close()

    print(
        f"\nCon {floor:.0f} ms por consulta, un endpoint que haga 10 consultas\n"
        f"no puede bajar de {floor * 10 / 1000:.1f} s por más que se optimice el código."
    )


async def _timed(connection: asyncpg.Connection, query: str) -> float:
    started = time.perf_counter()
    await connection.fetchval(query)
    return (time.perf_counter() - started) * 1000


asyncio.run(main())
