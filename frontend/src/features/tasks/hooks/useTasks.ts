import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { queryClient } from '../../../shared/queryClient'
import { completeAllTasks, createTask, fetchTasks, fetchTasksPage, updateTask } from '../api'
import type { TaskPageQuery, TaskStatus } from '../types'
import { taskKeys } from '../keys'

export type { TaskInput } from '../types'

export function useTasks(status?: TaskStatus, leadId?: string, assignedUserId?: number, allUsers = false) {
  return useQuery({
    queryKey: taskKeys.list(status, leadId, assignedUserId, allUsers),
    queryFn: () => fetchTasks(leadId, assignedUserId, allUsers),
  })
}

/** Una página de la bandeja de pendientes. Mientras llega la siguiente se
 *  sigue viendo la anterior, como en la lista de embudos. */
export function useTasksPage(query: TaskPageQuery) {
  return useQuery({
    queryKey: taskKeys.page(query),
    queryFn: () => fetchTasksPage(query),
    placeholderData: keepPreviousData,
  })
}

function invalidateTasks() {
  void queryClient.invalidateQueries({ queryKey: taskKeys.all })
}

export function useCreateTask() {
  return useMutation({ mutationFn: createTask, onSuccess: invalidateTasks })
}

export function useUpdateTask() {
  return useMutation({
    mutationFn: updateTask,
    onSuccess: invalidateTasks,
  })
}

export function useCompleteAllTasks() {
  return useMutation({
    mutationFn: completeAllTasks,
    onSuccess: invalidateTasks,
  })
}
