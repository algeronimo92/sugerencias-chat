"""Consumer contract: only the operations used outside this capability."""

from app.modules.tasks.repository import (
    create_task,
)

__all__ = ['create_task']
