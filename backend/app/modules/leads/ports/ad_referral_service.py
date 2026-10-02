"""Consumer contract: only the operations used outside this capability."""

from app.modules.leads.ad_referral_service import (
    rehost_referral_image,
)

__all__ = ['rehost_referral_image']
