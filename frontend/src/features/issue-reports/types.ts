import type { JsonObject, UserRole } from '../../shared/types'

export type IssueReportStatus = 'new' | 'in_review' | 'needs_info' | 'resolved'
export type IssueReportPriority = 'low' | 'normal' | 'high' | 'critical'

export interface IssueReportAttachment {
  id: number
  media_url: string
  filename: string
  content_type: string
  size_bytes: number
}

export interface IssueReport {
  id: number
  public_code: string
  reporter_user_id: number
  reporter_name: string
  title: string
  description: string
  status: IssueReportStatus
  priority: IssueReportPriority
  current_path: string
  lead_id: string | null
  technical_context: JsonObject
  attachments: IssueReportAttachment[]
  comment_count: number
  resolved_at: string | null
  resolved_by_name: string | null
  created_at: string
  updated_at: string
}

export interface IssueReportComment {
  id: number
  author_user_id: number
  author_name: string
  author_role: UserRole
  content: string
  created_at: string
}

export interface IssueReportEvent {
  id: number
  actor_name: string | null
  event_type: 'created' | 'status_changed' | 'priority_changed'
  previous_value: string | null
  new_value: string | null
  created_at: string
}

export interface IssueReportDetail extends IssueReport {
  comments: IssueReportComment[]
  events: IssueReportEvent[]
}

export interface IssueEvidenceInput {
  contentType: string
  dataBase64: string
  filename: string
}

export interface CreateIssueReportInput {
  title: string
  description: string
  currentPath: string
  leadId: string | null
  technicalContext: JsonObject
  attachments: IssueEvidenceInput[]
}
