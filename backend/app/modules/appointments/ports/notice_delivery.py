"""Consumer contract: only the operations used outside this capability."""

from app.modules.appointments.application.notice import (
    notice_account_template_changed,
    record_notice_delivery,
)

__all__ = ['notice_account_template_changed', 'record_notice_delivery']
