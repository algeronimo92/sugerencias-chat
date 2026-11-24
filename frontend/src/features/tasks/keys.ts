import type { TaskPageQuery } from './types'

export const taskKeys = {
  all: ['tasks'] as const,
  list: (status: string | undefined, leadId: string | undefined, assignedUserId: number | undefined, allUsers: boolean | undefined) =>
    ['tasks', status ?? 'all', leadId ?? 'all', assignedUserId ?? 'mine', allUsers] as const,
  page: (query: TaskPageQuery) => ['tasks', 'page', query] as const,
}
