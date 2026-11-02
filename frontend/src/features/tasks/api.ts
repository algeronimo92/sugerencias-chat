import client from '../../shared/http/client'
import type { ApiResponse } from '../../shared/http/contract'
import type { LeadTask, TaskInput, TaskStatus } from './types'


export async function fetchTasks(leadId: string | undefined, assignedUserId: number | undefined, allUsers: boolean): Promise<LeadTask[]> {
  return (await client.get<ApiResponse<'/api/tasks', 'get'>>('/api/tasks', {
      params: { status, lead_id: leadId, assigned_user_id: assignedUserId, all_users: allUsers || undefined },
    })).data
}

export async function createTask(input: TaskInput): Promise<LeadTask> {
  return (await client.post<ApiResponse<'/api/tasks', 'post'>>('/api/tasks', input)).data
}

export async function updateTask({ id, ...values }: Partial<TaskInput> & { id: number; status?: TaskStatus }): Promise<LeadTask> {
  return (await client.patch<ApiResponse<'/api/tasks/{task_id}', 'patch'>>(`/api/tasks/${id}`, values)).data
}

export async function completeAllTasks({ assignedUserId, allUsers }: { assignedUserId?: number; allUsers?: boolean }): Promise<{ completed: number }> {
  return (
      await client.post<ApiResponse<'/api/tasks/complete-all', 'post'>>('/api/tasks/complete-all', undefined, {
        params: {
          assigned_user_id: assignedUserId,
          all_users: allUsers || undefined,
        },
      })
    ).data
}
