"""Consumer contract: only the operations used outside this capability."""

from app.modules.automations.domain.rules import (
    render_variables,
)

__all__ = ['render_variables']
