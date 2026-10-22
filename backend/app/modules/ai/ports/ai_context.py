"""Consumer contract: only the operations used outside this capability."""

from app.modules.ai.ai_context import (
    fetch_analysis_context,
    fetch_context_revision,
)

__all__ = ['fetch_analysis_context', 'fetch_context_revision']
