import type { IssueReportPriority, IssueReportStatus } from '../types'


export const ISSUE_STATUS_LABELS: Record<IssueReportStatus, string> = {
  new: 'Nuevo',
  in_review: 'En revisión',
  needs_info: 'Necesita información',
  resolved: 'Resuelto',
}

export const ISSUE_STATUS_COLORS: Record<IssueReportStatus, string> = {
  new: 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  in_review: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300',
  needs_info: 'bg-violet-100 text-violet-800 dark:bg-violet-950/50 dark:text-violet-300',
  resolved: 'bg-green-100 text-green-800 dark:bg-green-950/50 dark:text-green-300',
}

export const ISSUE_PRIORITY_LABELS: Record<IssueReportPriority, string> = {
  low: 'Baja',
  normal: 'Normal',
  high: 'Alta',
  critical: 'Crítica',
}

export const ISSUE_PRIORITY_COLORS: Record<IssueReportPriority, string> = {
  low: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
  normal: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-300',
  high: 'bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300',
  critical: 'bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300',
}
