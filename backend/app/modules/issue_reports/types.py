"""Estados y prioridades de los reportes de problemas."""

from enum import StrEnum


class IssueReportStatus(StrEnum):
    NEW = "new"
    IN_REVIEW = "in_review"
    NEEDS_INFO = "needs_info"
    RESOLVED = "resolved"


class IssueReportPriority(StrEnum):
    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


class IssueReportEventType(StrEnum):
    CREATED = "created"
    STATUS_CHANGED = "status_changed"
    PRIORITY_CHANGED = "priority_changed"
