import asyncio

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

        async def deliver(websocket: WebSocket) -> WebSocket | None:
            try:
                await asyncio.wait_for(websocket.send_json(message), timeout=2.0)
                return None
            except Exception:
                return websocket

        dead = [item for item in await asyncio.gather(*(deliver(ws) for ws in connections)) if item]
        if dead:
            async with self._lock:
                for websocket in dead:
                    self._connections.pop(websocket, None)

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
