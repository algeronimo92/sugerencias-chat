import client from '../../shared/http/client'
import type { ApiResponse } from '../../shared/http/contract'
import type { LeadTask, TaskInput, TaskPage, TaskPageQuery, TaskStatus } from './types'


// `status` llega como parámetro: sin él, el `status` de abajo era la global
// `window.status` (siempre "") y el backend devolvía también las completadas y
// canceladas. Así la bandeja llegó a mostrar 500 "pendientes" que no lo eran y
// la tarjeta del chat podía proponer como próxima una tarea ya cerrada.
export async function fetchTasks(status: TaskStatus | undefined, leadId: string | undefined, assignedUserId: number | undefined, allUsers: boolean): Promise<LeadTask[]> {
  return (await client.get<ApiResponse<'/api/tasks', 'get'>>('/api/tasks', {
      params: { status, lead_id: leadId, assigned_user_id: assignedUserId, all_users: allUsers || undefined },
    })).data
}

export async function fetchTasksPage(query: TaskPageQuery): Promise<TaskPage> {
  return (await client.get<ApiResponse<'/api/tasks/page', 'get'>>('/api/tasks/page', {
      params: {
        day_end: query.dayEnd,
        status: query.status,
        search: query.search || undefined,
        bucket: query.bucket,
        assigned_user_id: query.assignedUserId,
        all_users: query.allUsers || undefined,
        offset: query.offset,
        limit: query.limit,
      },
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
