/** Tiempo real de tareas: la lista y el recordatorio de una tarea. */

import { invalidate, type RealtimeModule } from '../../realtime/bus'
import { taskKeys } from './keys'

export function createTasksRealtime(): RealtimeModule {
  return {
    handlers: {
      lead_visibility_changed: (_event, { queryClient }) => {
        void queryClient.resetQueries({ queryKey: taskKeys.all })
      },
      tasks_updated: (_event, { queryClient }) => invalidate(queryClient, taskKeys.all),
      task_reminder: ({ task }, { queryClient, navigate, notify }) => {
        invalidate(queryClient, taskKeys.all)
        notify(
          `Recordatorio: ${task.lead_name || 'Lead'}`,
          task.title,
          () => navigate(`/chat/${task.lead_id}`),
          { force: true, tag: `task-reminder-${task.task_id}` },
        )
      },
    },
  }
}
