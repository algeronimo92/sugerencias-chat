"""``contador_noshow`` lo incrementa POST /api/chats/{id}/no-show, una acción
humana del vendedor: el sistema no puede saber solo si alguien asistió.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.leads import api as chats
from app.modules.leads.domain.errors import LeadNotFound

LEAD_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"
ADMIN = SimpleNamespace(role="admin", id=1)


async def test_register_no_show_returns_updated_chat(in_memory_leads, monkeypatch):
    in_memory_leads.repository.seed(LEAD_ID, contador_noshow=0)
    monkeypatch.setattr(chats, "fetch_chat", AsyncMock(return_value={"chat_id": LEAD_ID, "contador_noshow": 1}))

    result = await chats.register_no_show(LEAD_ID, ADMIN)

    assert in_memory_leads.repository.column(LEAD_ID, "contador_noshow") == 1
    assert result == {"chat_id": LEAD_ID, "contador_noshow": 1}


async def test_register_no_show_missing_lead_returns_404(in_memory_leads):
    with pytest.raises(LeadNotFound) as exc:
        await chats.register_no_show(LEAD_ID, ADMIN)

    assert exc.value.status_code == 404
