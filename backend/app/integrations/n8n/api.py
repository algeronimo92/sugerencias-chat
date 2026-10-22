from fastapi import APIRouter

from app.integrations.n8n import leads_api as leads, raw_api as raw
from app.integrations.n8n.common import _parse_iso_datetime  # noqa: F401
from app.integrations.n8n.leads_api import apply_analysis_job_webhook, lead_analysis_webhook, lead_inbound_activity_webhook, lead_stage_webhook, lead_touch_webhook
from app.integrations.n8n.raw_api import ai_catalog_webhook, analysis_context_webhook, last_message_raw_webhook, lead_messages_raw_webhook, lead_raw_webhook, rag_context_webhook, rag_search_webhook

# Integraciones autenticadas con el token compartido (los workflows de IA de
# n8n). El webhook de Meta no pasa por acá: tiene su propio router
# (app/integrations/meta_webhook/api.py) y se autentica con la firma de Meta.
router = APIRouter()

router.include_router(leads.router)
router.include_router(raw.router)
