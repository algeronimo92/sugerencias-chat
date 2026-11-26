from fastapi import APIRouter

from app.integrations.n8n import leads_api as leads, raw_api as raw
from app.integrations.n8n.leads_api import apply_analysis_job_webhook
from app.integrations.n8n.raw_api import analysis_context_webhook

# Lo único que queda de n8n es el workflow del analista de leads: pide el
# contexto del job y aplica su resultado, autenticado con el token compartido.
# Los mensajes de Meta entran directo por app/integrations/meta_webhook/api.py.
router = APIRouter()

router.include_router(leads.router)
router.include_router(raw.router)
