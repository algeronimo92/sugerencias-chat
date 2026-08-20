import { useMutation, useQuery } from '@tanstack/react-query'
import client from '../api/client'
import { queryClient } from '../queryClient'
import type { IssueReport, IssueReportComment, IssueReportDetail, IssueReportPriority, IssueReportStatus, JsonObject } from '../types'


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

export function useIssueReports(status: IssueReportStatus | '' = '', priority: IssueReportPriority | '' = '') {
  return useQuery({
    queryKey: ['issue-reports', status, priority],
    queryFn: async () => (await client.get<IssueReport[]>('/api/issue-reports', {
      params: { status: status || undefined, priority: priority || undefined },
    })).data,
  })
}

export function useIssueReport(reportId: number | null) {
  return useQuery({
    queryKey: ['issue-reports', 'detail', reportId],
    queryFn: async () => (await client.get<IssueReportDetail>(`/api/issue-reports/${reportId}`)).data,
    enabled: reportId != null,
  })
}

export function useCreateIssueReport() {
  return useMutation({
    mutationFn: async (input: CreateIssueReportInput) => (await client.post<IssueReport>('/api/issue-reports', {
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
    })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['issue-reports'] }),
  })
}

export function useUpdateIssueReport() {
  return useMutation({
    mutationFn: async ({ id, status, priority }: { id: number; status?: IssueReportStatus; priority?: IssueReportPriority }) =>
      (await client.patch<IssueReport>(`/api/issue-reports/${id}`, { status, priority })).data,
    onSuccess: report => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['issue-reports'] }),
      queryClient.invalidateQueries({ queryKey: ['issue-reports', 'detail', report.id] }),
    ]),
  })
}

export function useAddIssueReportComment() {
  return useMutation({
    mutationFn: async ({ reportId, content }: { reportId: number; content: string }) =>
      (await client.post<IssueReportComment>(`/api/issue-reports/${reportId}/comments`, { content })).data,
    onSuccess: (_comment, input) => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['issue-reports'] }),
      queryClient.invalidateQueries({ queryKey: ['issue-reports', 'detail', input.reportId] }),
    ]),
  })
}
