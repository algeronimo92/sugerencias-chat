import { useMutation, useQuery } from '@tanstack/react-query'
import { queryClient } from '../../../shared/queryClient'
import { completeAllTasks, createTask, fetchTasks, updateTask } from '../api'
import type { TaskStatus } from '../types'
import { taskKeys } from '../keys'

export type { TaskInput } from '../types'

export function useTasks(status?: TaskStatus, leadId?: string, assignedUserId?: number, allUsers = false) {
  return useQuery({
    queryKey: taskKeys.list(status, leadId, assignedUserId, allUsers),
    queryFn: () => fetchTasks(leadId, assignedUserId, allUsers),
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
