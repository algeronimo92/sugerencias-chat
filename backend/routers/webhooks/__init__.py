from fastapi import APIRouter

from routers.webhooks import (
    identity,
    inbox,
    leads,
    messages,
    meta_auth,
    outgoing,
    raw,
    media,
)
from routers.webhooks.common import _parse_iso_datetime  # noqa: F401
from routers.webhooks.identity import (  # noqa: F401
    resolve_whatsapp_identity_webhook,
)
from routers.webhooks.leads import (  # noqa: F401
    apply_analysis_job_webhook,
    ensure_lead_webhook,
    lead_analysis_webhook,
    lead_inbound_activity_webhook,
    lead_stage_webhook,
    lead_touch_webhook,
)
from routers.webhooks.messages import (  # noqa: F401
    message_deleted_webhook,
    message_edited_secret_webhook,
    message_edited_webhook,
    message_status_webhook,
    new_message_webhook,
    poll_results_webhook,
    reaction_webhook,
    save_inbound_message_webhook,
)
from routers.webhooks.outgoing import (  # noqa: F401
    outgoing_analysis_webhook,
    outgoing_webhook,
)
from routers.webhooks.raw import (  # noqa: F401
    ai_catalog_webhook,
    analysis_context_webhook,
    last_message_raw_webhook,
    lead_messages_raw_webhook,
    lead_raw_webhook,
    message_by_wa_id_raw_webhook,
    rag_context_webhook,
    rag_search_webhook,
)
from routers.webhooks.media import (  # noqa: F401
    meta_media_import_webhook,
)

router = APIRouter()

router.include_router(identity.router)
router.include_router(inbox.router)
router.include_router(leads.router)
router.include_router(messages.router)
router.include_router(meta_auth.router)
router.include_router(outgoing.router)
router.include_router(raw.router)
router.include_router(media.router)
