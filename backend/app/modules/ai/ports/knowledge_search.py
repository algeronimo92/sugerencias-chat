"""Consumer contract: only the operations used outside this capability."""

from app.modules.ai.knowledge_search import (
    search_knowledge_chunks,
)

__all__ = ['search_knowledge_chunks']
