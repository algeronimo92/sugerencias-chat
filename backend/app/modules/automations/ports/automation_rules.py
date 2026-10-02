"""Consumer contract: only the operations used outside this capability."""

from app.modules.automations.automation_rules import (
    render_variables,
)

__all__ = ['render_variables']
