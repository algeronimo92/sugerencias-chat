"""Consumer contract: only the operations used outside this capability."""

from app.modules.automations.automation_scheduling import (
    schedule_automation_event_in_session,
)

__all__ = ['schedule_automation_event_in_session']
