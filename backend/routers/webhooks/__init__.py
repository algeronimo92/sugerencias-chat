from fastapi import APIRouter

from routers.webhooks import leads, raw
from routers.webhooks.common import _parse_iso_datetime  # noqa: F401
from routers.webhooks.leads import (  # noqa: F401
    apply_analysis_job_webhook,
    lead_analysis_webhook,
    lead_inbound_activity_webhook,
    lead_stage_webhook,
    lead_touch_webhook,
)
from routers.webhooks.raw import (  # noqa: F401
    ai_catalog_webhook,
    analysis_context_webhook,
    last_message_raw_webhook,
    lead_messages_raw_webhook,
    lead_raw_webhook,
    rag_context_webhook,
    rag_search_webhook,
)

# Integraciones autenticadas con el token compartido (los workflows de IA de
# n8n). El webhook de Meta no pasa por acá: tiene su propio router
# (routers/meta_webhook.py) y se autentica con la firma de Meta.
router = APIRouter()

router.include_router(leads.router)
router.include_router(raw.router)
