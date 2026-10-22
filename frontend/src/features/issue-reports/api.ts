import client from '../../shared/http/client'
import type { ApiResponse } from '../../shared/http/contract'
import type {
  CreateIssueReportInput,
  IssueReport,
  IssueReportComment,
  IssueReportDetail,
  IssueReportPriority,
  IssueReportStatus,
} from './types'

export async function fetchIssueReports(
  status: IssueReportStatus | '' = '',
  priority: IssueReportPriority | '' = '',
): Promise<IssueReport[]> {
  return (await client.get<ApiResponse<'/api/issue-reports', 'get'>>('/api/issue-reports', {
    params: { status: status || undefined, priority: priority || undefined },
  })).data
}

export async function fetchIssueReport(reportId: number): Promise<IssueReportDetail> {
  return (await client.get<ApiResponse<'/api/issue-reports/{report_id}', 'get'>>(`/api/issue-reports/${reportId}`)).data
}

export async function createIssueReport(input: CreateIssueReportInput): Promise<IssueReport> {
  return (await client.post<ApiResponse<'/api/issue-reports', 'post'>>('/api/issue-reports', {
    title: input.title,
    description: input.description,
    current_path: input.currentPath,
    lead_id: input.leadId,
    technical_context: input.technicalContext,
    attachments: input.attachments.map(attachment => ({
      content_type: attachment.contentType,
      data_base64: attachment.dataBase64,
      filename: attachment.filename,
    })),
  })).data
}

export async function updateIssueReport({
  id,
  status,
  priority,
}: {
  id: number
  status?: IssueReportStatus
  priority?: IssueReportPriority
}): Promise<IssueReport> {
  return (await client.patch<ApiResponse<'/api/issue-reports/{report_id}', 'patch'>>(`/api/issue-reports/${id}`, { status, priority })).data
}

export async function addIssueReportComment({ reportId, content }: { reportId: number; content: string }): Promise<IssueReportComment> {
  return (await client.post<ApiResponse<'/api/issue-reports/{report_id}/comments', 'post'>>(`/api/issue-reports/${reportId}/comments`, { content })).data
}
