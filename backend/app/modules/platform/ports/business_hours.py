"""Consumer contract: only the operations used outside this capability."""

from app.modules.platform.business_hours import BusinessHours, business_hours

__all__ = ['BusinessHours', 'business_hours']
