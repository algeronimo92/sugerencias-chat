import asyncio
import contextlib

from fastapi import WebSocket


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
        for websocket in connections:
            with contextlib.suppress(Exception):
                await websocket.send_json(message)

    async def send_to_user(self, user_id: int, message: dict) -> bool:
        async with self._lock:
            connections = [ws for ws, owner_id in self._connections.items() if owner_id == user_id]
        delivered = False
        for websocket in connections:
            try:
                await websocket.send_json(message)
                delivered = True
            except Exception:
                pass
        return delivered


manager = ConnectionManager()
