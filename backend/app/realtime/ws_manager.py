"""Conexiones y distribución WebSocket aisladas por tenant.

Cada proceso conoce solo sus propias conexiones. Lo que se emite acá se
entrega a las locales y viaja por el bus de señales (``app.db.signals``) a
las demás réplicas, que lo entregan a las suyas: un aviso emitido por el
worker llega al navegador conectado a cualquier réplica de la API.
"""

import asyncio
import logging
from dataclasses import dataclass
from uuid import UUID

from fastapi import WebSocket

from app.db import signals
from app.tenancy.context import get_current_tenant

logger = logging.getLogger(__name__)


@dataclass(frozen=True, slots=True)
class SocketOwner:
    """Identidad mínima de una conexión en tiempo real.

    Los IDs de usuario se repiten entre schemas. Guardar sólo ``user_id`` hacía
    que una notificación dirigida pudiera terminar en otro negocio y que un
    broadcast llegara a todas las pestañas conectadas al proceso.
    """

    user_id: int
    organization_id: UUID | None


def _active_organization_id() -> UUID | None:
    context = get_current_tenant()
    return context.organization_id if context else None


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: dict[WebSocket, SocketOwner] = {}
        self._lock = asyncio.Lock()

    async def connect(
        self,
        websocket: WebSocket,
        user_id: int,
        organization_id: UUID | None = None,
    ) -> None:
        await websocket.accept()
        if organization_id is None:
            organization_id = _active_organization_id()
        async with self._lock:
            self._connections[websocket] = SocketOwner(user_id, organization_id)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.pop(websocket, None)

    async def broadcast(
        self,
        message: dict,
        *,
        organization_id: UUID | None = None,
    ) -> None:
        if organization_id is None:
            organization_id = _active_organization_id()
        await self._broadcast_here(message, organization_id)
        await signals.ring_remote(REALTIME_SIGNAL, {
            "kind": "broadcast", "organization_id": _wire(organization_id), "message": message,
        })

    async def _broadcast_here(self, message: dict, organization_id: UUID | None) -> None:
        async with self._lock:
            connections = [
                websocket
                for websocket, owner in self._connections.items()
                if owner.organization_id == organization_id
            ]

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

    async def disconnect_organization(self, organization_id: UUID) -> None:
        """Corta toda conexión ya abierta de un negocio -- a diferencia de
        `broadcast`, que solo da de baja las que fallan al *enviar*, esta
        cierra las que siguen vivas. Se usa al suspender un tenant: el
        middleware ya niega conexiones nuevas para ese host, pero un socket
        abierto antes de la suspensión no vuelve a pasar por él hasta que se
        corta y el navegador reconecta."""
        await self._disconnect_here(organization_id)
        await signals.ring_remote(REALTIME_SIGNAL, {
            "kind": "disconnect", "organization_id": _wire(organization_id),
        })

    async def _disconnect_here(self, organization_id: UUID | None) -> None:
        async with self._lock:
            connections = [
                websocket
                for websocket, owner in self._connections.items()
                if owner.organization_id == organization_id
            ]
            for websocket in connections:
                self._connections.pop(websocket, None)
        for websocket in connections:
            try:
                await websocket.close()
            except Exception:
                logger.debug(
                    "No se pudo cerrar una conexión WebSocket al suspender el tenant", exc_info=True,
                )

    async def connection_count(self) -> int:
        async with self._lock:
            return len(self._connections)

    async def send_to_user(
        self,
        user_id: int,
        message: dict,
        *,
        organization_id: UUID | None = None,
    ) -> None:
        """Entrega a todas las pestañas del usuario, en cualquier réplica."""
        if organization_id is None:
            organization_id = _active_organization_id()
        await self.send_to_user_here(user_id, message, organization_id=organization_id)
        await signals.ring_remote(REALTIME_SIGNAL, {
            "kind": "user", "organization_id": _wire(organization_id), "user_id": user_id, "message": message,
        })

    async def send_to_user_here(
        self,
        user_id: int,
        message: dict,
        *,
        organization_id: UUID | None = None,
    ) -> bool:
        """Solo a las conexiones de este proceso; devuelve si alguna lo
        recibió. Lo usan los recordatorios de tareas, que se liberan para
        otra réplica cuando el usuario no está conectado a esta."""
        if organization_id is None:
            organization_id = _active_organization_id()
        async with self._lock:
            connections = [
                websocket
                for websocket, owner in self._connections.items()
                if owner.user_id == user_id and owner.organization_id == organization_id
            ]
        if not connections:
            return False
        results = await asyncio.gather(*(
            asyncio.wait_for(websocket.send_json(message), timeout=2.0)
            for websocket in connections
        ), return_exceptions=True)
        return any(not isinstance(result, BaseException) for result in results)


REALTIME_SIGNAL = "realtime"


def _wire(organization_id: UUID | None) -> str | None:
    return str(organization_id) if organization_id is not None else None


def _unwire(value: str | None) -> UUID | None:
    return UUID(value) if value else None


manager = ConnectionManager()


@signals.signal(REALTIME_SIGNAL).on
async def _from_other_process(payload: dict) -> None:
    """Lo que otra réplica emitió, entregado a las conexiones de esta."""
    organization_id = _unwire(payload.get("organization_id"))
    kind = payload.get("kind")
    if kind == "broadcast":
        await manager._broadcast_here(payload["message"], organization_id)
    elif kind == "user":
        await manager.send_to_user_here(payload["user_id"], payload["message"], organization_id=organization_id)
    elif kind == "disconnect":
        await manager._disconnect_here(organization_id)
