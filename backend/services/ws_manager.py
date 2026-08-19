import asyncio
import logging

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[WebSocket, int] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket, user_id: int) -> None:
        await websocket.accept()
        async with self._lock:
            self._connections[websocket] = user_id

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.pop(websocket, None)

    async def broadcast(self, message: dict) -> None:
        async with self._lock:
            connections = list(self._connections)

        async def deliver(websocket: WebSocket) -> WebSocket | None:
            try:
                await asyncio.wait_for(websocket.send_json(message), timeout=2.0)
                return None
            except Exception:
                # Rutina esperada: el cliente cerró la pestaña, perdió red o
                # backgrounding móvil cortó el socket. No es un error de la
                # app -- pasa en cada broadcast con clientes desconectados --
                # así que se registra en debug, no como excepción a nivel
                # ERROR (eso saturaría el panel de errores de Grafana).
                logger.debug("Envío por WebSocket falló; se marca la conexión como caída", exc_info=True)
                return websocket

        dead = [item for item in await asyncio.gather(*(deliver(ws) for ws in connections)) if item]
        if dead:
            async with self._lock:
                for websocket in dead:
                    self._connections.pop(websocket, None)
            # Cerrar la conexión, no solo sacarla del registro: si queda abierta,
            # el cliente sigue creyéndose conectado (no dispara onclose) y no
            # recibe nada ni pollea. Al cerrarla, reconecta y resincroniza.
            for websocket in dead:
                try:
                    await websocket.close()
                except Exception:
                    # Misma razón que arriba: cerrar un socket ya muerto
                    # falla de forma rutinaria, no es un error de la app.
                    logger.debug("No se pudo cerrar una conexión WebSocket ya marcada como caída", exc_info=True)

    async def connection_count(self) -> int:
        async with self._lock:
            return len(self._connections)

    async def send_to_user(self, user_id: int, message: dict) -> bool:
        async with self._lock:
            connections = [ws for ws, owner_id in self._connections.items() if owner_id == user_id]
        if not connections:
            return False
        results = await asyncio.gather(*(
            asyncio.wait_for(websocket.send_json(message), timeout=2.0)
            for websocket in connections
        ), return_exceptions=True)
        return any(not isinstance(result, BaseException) for result in results)


manager = ConnectionManager()
