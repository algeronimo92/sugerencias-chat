import { useMutation, useQuery } from '@tanstack/react-query'
import client from '../api/client'
import { queryClient } from '../queryClient'
import type { LeadTask, TaskPriority, TaskStatus, TaskType } from '../types'

export interface TaskInput {
  lead_id: string
  title: string
  description?: string | null
  task_type: TaskType
  priority: TaskPriority
  due_at: string
  remind_at?: string | null
  assigned_user_id?: number
}

export function useTasks(status?: TaskStatus, leadId?: string, assignedUserId?: number, allUsers = false) {
  return useQuery({
    queryKey: ['tasks', status ?? 'all', leadId ?? 'all', assignedUserId ?? 'mine', allUsers],
    queryFn: async () => (await client.get<LeadTask[]>('/api/tasks', {
      params: { status, lead_id: leadId, assigned_user_id: assignedUserId, all_users: allUsers || undefined },
    })).data,
  })
}

function invalidateTasks() {
  void queryClient.invalidateQueries({ queryKey: ['tasks'] })
}

export function useCreateTask() {
  return useMutation({ mutationFn: async (input: TaskInput) => (await client.post<LeadTask>('/api/tasks', input)).data, onSuccess: invalidateTasks })
}

export function useUpdateTask() {
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<TaskInput> & { id: number; status?: TaskStatus }) =>
      (await client.patch<LeadTask>(`/api/tasks/${id}`, values)).data,
    onSuccess: invalidateTasks,
  })
}
