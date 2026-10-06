import { useMutation, useQuery } from '@tanstack/react-query'
import { queryClient } from '../../../shared/queryClient'
import { completeAllTasks, createTask, fetchTasks, updateTask } from '../api'
import type { TaskStatus } from '../types'

export type { TaskInput } from '../types'

export function useTasks(status?: TaskStatus, leadId?: string, assignedUserId?: number, allUsers = false) {
  return useQuery({
    queryKey: ['tasks', status ?? 'all', leadId ?? 'all', assignedUserId ?? 'mine', allUsers],
    queryFn: () => fetchTasks(leadId, assignedUserId, allUsers),
  })
}

function invalidateTasks() {
  void queryClient.invalidateQueries({ queryKey: ['tasks'] })
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
