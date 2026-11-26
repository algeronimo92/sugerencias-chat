"""Consumer contract: lo que los demás módulos miran del paquete del negocio."""

from app.modules.platform.entitlements import (
    ai_quota_message,
    ai_unavailable_message,
    current_plan,
    ensure_automation_slot,
    ensure_feature,
    ensure_seat_available,
    has_feature,
    require_feature,
)
from app.modules.platform.plans import Feature

__all__ = [
    'Feature',
    'ai_quota_message',
    'ai_unavailable_message',
    'current_plan',
    'ensure_automation_slot',
    'ensure_feature',
    'ensure_seat_available',
    'has_feature',
    'require_feature',
]
