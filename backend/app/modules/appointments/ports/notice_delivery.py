"""Consumer contract: only the operations used outside this capability."""

from app.modules.appointments.application.notice import (
    record_notice_delivery,
)

__all__ = ['record_notice_delivery']
