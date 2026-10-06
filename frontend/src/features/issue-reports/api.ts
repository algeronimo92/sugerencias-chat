import client from '../../shared/http/client'
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
) {
  return (await client.get<IssueReport[]>('/api/issue-reports', {
    params: { status: status || undefined, priority: priority || undefined },
  })).data
}

export async function fetchIssueReport(reportId: number) {
  return (await client.get<IssueReportDetail>(`/api/issue-reports/${reportId}`)).data
}

export async function createIssueReport(input: CreateIssueReportInput) {
  return (await client.post<IssueReport>('/api/issue-reports', {
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
}) {
  return (await client.patch<IssueReport>(`/api/issue-reports/${id}`, { status, priority })).data
}

export async function addIssueReportComment({ reportId, content }: { reportId: number; content: string }) {
  return (await client.post<IssueReportComment>(`/api/issue-reports/${reportId}/comments`, { content })).data
}
