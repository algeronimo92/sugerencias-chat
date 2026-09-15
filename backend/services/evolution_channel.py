from datetime import datetime

import httpx

from services import evolution_service, whatsapp_history


class EvolutionHistoryReader:
    async def is_available(self) -> bool:
        try:
            return bool((await evolution_service.get_instance_capabilities())["history_available"])
        except (evolution_service.EvolutionApiError, httpx.HTTPError):
            return False

    async def fetch(self, chat_id: str, page: int | None, before_ts: datetime | None) -> dict:
        return await whatsapp_history.fetch_whatsapp_history(chat_id, page, before_ts)
