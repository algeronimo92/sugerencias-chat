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
import { issueReportKeys } from './keys'

export function useIssueReports(status: IssueReportStatus | '' = '', priority: IssueReportPriority | '' = '') {
  return useQuery({
    queryKey: issueReportKeys.list(status, priority),
    queryFn: () => fetchIssueReports(status, priority),
  })
}

export function useIssueReport(reportId: number | null) {
  return useQuery({
    queryKey: issueReportKeys.detail(reportId),
    queryFn: () => fetchIssueReport(reportId as number),
    enabled: reportId != null,
  })
}

export function useCreateIssueReport() {
  return useMutation({
    mutationFn: (input: CreateIssueReportInput) => createIssueReport(input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: issueReportKeys.all }),
  })
}

export function useUpdateIssueReport() {
  return useMutation({
    mutationFn: (input: { id: number; status?: IssueReportStatus; priority?: IssueReportPriority }) =>
      updateIssueReport(input),
    onSuccess: report => Promise.all([
      queryClient.invalidateQueries({ queryKey: issueReportKeys.all }),
      queryClient.invalidateQueries({ queryKey: issueReportKeys.detail(report.id) }),
    ]),
  })
}

export function useAddIssueReportComment() {
  return useMutation({
    mutationFn: (input: { reportId: number; content: string }) => addIssueReportComment(input),
    onSuccess: (_comment, input) => Promise.all([
      queryClient.invalidateQueries({ queryKey: issueReportKeys.all }),
      queryClient.invalidateQueries({ queryKey: issueReportKeys.detail(input.reportId) }),
    ]),
  })
}
