import httpx
from config import settings
from models.schemas import SuggestionResponse


async def call_n8n(chat_id: str, phone: str | None) -> SuggestionResponse:
    headers = {}
    if settings.n8n_webhook_token:
        headers["Authorization"] = f"Bearer {settings.n8n_webhook_token}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.get(
            settings.n8n_webhook_url,
            params={"chat_id": chat_id},
            headers=headers,
        )
        response.raise_for_status()
        # n8n devuelve un array: [{"output": {...}}]
        data = response.json()
        output = data[0]["output"]

    return SuggestionResponse(**output)
