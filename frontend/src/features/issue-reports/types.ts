import type { JsonObject } from '../../shared/types'
import type { ApiSchemas, Delivered } from '../../shared/http/contract'

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

export type IssueReportComment = Delivered<ApiSchemas['IssueReportCommentItem']>

/** Un evento del historial del reporte. `event_type` llega como texto: los
 * que la pantalla conoce son 'created', 'status_changed' y 'priority_changed'. */
export type IssueReportEvent = Delivered<ApiSchemas['IssueReportEventItem']>

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
