import { useMutation, useQuery } from '@tanstack/react-query'
import client from '../api/client'
import { queryClient } from '../queryClient'
import type { IssueReport, IssueReportStatus, JsonObject } from '../types'


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

export function useIssueReports(status: IssueReportStatus | '' = '') {
  return useQuery({
    queryKey: ['issue-reports', status],
    queryFn: async () => (await client.get<IssueReport[]>('/api/issue-reports', {
      params: { status: status || undefined },
    })).data,
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

export function useUpdateIssueReportStatus() {
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: IssueReportStatus }) =>
      (await client.patch<IssueReport>(`/api/issue-reports/${id}`, { status })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['issue-reports'] }),
  })
}
