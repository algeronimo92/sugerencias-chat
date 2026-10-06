import { useMutation, useQuery } from '@tanstack/react-query'
import { queryClient } from '../../shared/queryClient'
import {
  addIssueReportComment,
  createIssueReport,
  fetchIssueReport,
  fetchIssueReports,
  updateIssueReport,
} from './api'
import type { CreateIssueReportInput, IssueReportPriority, IssueReportStatus } from './types'

export function useIssueReports(status: IssueReportStatus | '' = '', priority: IssueReportPriority | '' = '') {
  return useQuery({
    queryKey: ['issue-reports', status, priority],
    queryFn: () => fetchIssueReports(status, priority),
  })
}

export function useIssueReport(reportId: number | null) {
  return useQuery({
    queryKey: ['issue-reports', 'detail', reportId],
    queryFn: () => fetchIssueReport(reportId as number),
    enabled: reportId != null,
  })
}

export function useCreateIssueReport() {
  return useMutation({
    mutationFn: (input: CreateIssueReportInput) => createIssueReport(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['issue-reports'] }),
  })
}

export function useUpdateIssueReport() {
  return useMutation({
    mutationFn: (input: { id: number; status?: IssueReportStatus; priority?: IssueReportPriority }) =>
      updateIssueReport(input),
    onSuccess: report => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['issue-reports'] }),
      queryClient.invalidateQueries({ queryKey: ['issue-reports', 'detail', report.id] }),
    ]),
  })
}

export function useAddIssueReportComment() {
  return useMutation({
    mutationFn: (input: { reportId: number; content: string }) => addIssueReportComment(input),
    onSuccess: (_comment, input) => Promise.all([
      queryClient.invalidateQueries({ queryKey: ['issue-reports'] }),
      queryClient.invalidateQueries({ queryKey: ['issue-reports', 'detail', input.reportId] }),
    ]),
  })
}
