"""Contratos HTTP de issue_reports."""

from uuid import UUID
from pydantic import BaseModel, Field, model_validator
from domain_types import IssueReportPriority, IssueReportStatus


class IssueReportAttachmentCreate(BaseModel):
    content_type: str = Field(min_length=1, max_length=100)
    data_base64: str = Field(min_length=1)
    filename: str = Field(min_length=1, max_length=255)


class IssueReportCreate(BaseModel):
    title: str = Field(min_length=3, max_length=120)
    description: str = Field(min_length=10, max_length=2000)
    current_path: str = Field(default="/", min_length=1, max_length=500)
    lead_id: UUID | None = None
    technical_context: dict = Field(default_factory=dict)
    attachments: list[IssueReportAttachmentCreate] = Field(default_factory=list, max_length=3)


class IssueReportUpdate(BaseModel):
    status: IssueReportStatus | None = None
    priority: IssueReportPriority | None = None

    @model_validator(mode="after")
    def require_change(self):
        if self.status is None and self.priority is None:
            raise ValueError("Debe indicar un estado o una prioridad")
        return self


class IssueReportCommentCreate(BaseModel):
    content: str = Field(min_length=1, max_length=2000)


class IssueReportAttachmentItem(BaseModel):
    id: int
    media_url: str
    filename: str
    content_type: str
    size_bytes: int


class IssueReportItem(BaseModel):
    id: int
    public_code: str
    reporter_user_id: int
    reporter_name: str
    title: str
    description: str
    status: IssueReportStatus
    priority: IssueReportPriority
    current_path: str
    lead_id: str | None = None
    technical_context: dict
    attachments: list[IssueReportAttachmentItem] = Field(default_factory=list)
    comment_count: int = 0
    resolved_at: str | None = None
    resolved_by_name: str | None = None
    created_at: str
    updated_at: str


class IssueReportCommentItem(BaseModel):
    id: int
    author_user_id: int
    author_name: str
    author_role: str
    content: str
    created_at: str


class IssueReportEventItem(BaseModel):
    id: int
    actor_name: str | None = None
    event_type: str
    previous_value: str | None = None
    new_value: str | None = None
    created_at: str


class IssueReportDetail(IssueReportItem):
    comments: list[IssueReportCommentItem] = Field(default_factory=list)
    events: list[IssueReportEventItem] = Field(default_factory=list)
