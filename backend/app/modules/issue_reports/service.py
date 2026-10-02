"""Use-case interface for issue reports.

Persistence currently has no additional orchestration, so the public service
functions delegate to the repository. Keeping this boundary explicit lets the
module grow without sending HTTP handlers back to SQL.
"""

from .repository import (
    InvalidReportContextError,
    create_issue_report,
    create_issue_report_comment,
    get_issue_report,
    get_issue_report_detail,
    list_active_admin_ids,
    list_issue_reports,
    update_issue_report,
)

__all__ = [
    "InvalidReportContextError",
    "create_issue_report",
    "create_issue_report_comment",
    "get_issue_report",
    "get_issue_report_detail",
    "list_active_admin_ids",
    "list_issue_reports",
    "update_issue_report",
]
