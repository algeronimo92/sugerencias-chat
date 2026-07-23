import { Check, Clock, Loader2, MessageSquare } from 'lucide-react'
import { useState } from 'react'
import type { LeadTask } from '../types'
import { useTasks, useUpdateTask } from '../hooks/useTasks'
import { useMe } from '../hooks/useAuth'
import { useUsers } from '../hooks/useUsers'
import { extractErrorMessage } from '../utils/errors'
import { TASK_PRIORITY_LABELS, TaskPriorityValue, TaskStatusValue } from '../domain/automationCatalog'
import type { TaskPriority } from '../types'

const PRIORITY_COLORS: Record<TaskPriority, string> = {
  [TaskPriorityValue.Low]: 'bg-wa-field dark:bg-wa-head-dark text-gray-600 dark:text-gray-300',
  [TaskPriorityValue.Normal]: 'bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-400',
  [TaskPriorityValue.High]: 'bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400',
}

function bucketTasks(tasks: LeadTask[]) {
  const groups: Record<'vencidas' | 'hoy' | 'proximas', LeadTask[]> = { vencidas: [], hoy: [], proximas: [] }
  const today = new Date().toDateString()
  for (const task of tasks) {
    if (task.is_overdue) groups.vencidas.push(task)
    else if (new Date(task.due_at).toDateString() === today) groups.hoy.push(task)
    else groups.proximas.push(task)
  }
  return groups
}

export function TasksPage({ onOpenChat }: { onOpenChat: (chatId: string) => void }) {
  const { data: me } = useMe()
  const isAdmin = me?.role === 'admin'
  const { data: users = [] } = useUsers(!!isAdmin)
  const [assignee, setAssignee] = useState<string>('mine')
  const allUsers = assignee === 'all'
  const assignedUserId = assignee !== 'mine' && assignee !== 'all' ? Number(assignee) : undefined
  const { data = [], isLoading } = useTasks('pending', undefined, assignedUserId, allUsers)
  const { mutate: update, isPending: isUpdating } = useUpdateTask()
  const [error, setError] = useState<string | null>(null)
  const groups = bucketTasks(data)
  const sections: { title: string; items: LeadTask[] }[] = [
    { title: 'Vencidas', items: groups.vencidas },
    { title: 'Para hoy', items: groups.hoy },
    { title: 'Próximas', items: groups.proximas },
  ]

  function handleComplete(id: number) {
    setError(null)
    update({ id, status: TaskStatusValue.Completed }, { onError: (err) => setError(extractErrorMessage(err)) })
  }

  return (
    <div className="h-full overflow-y-auto bg-wa-app p-6 dark:bg-wa-app-dark">
      <div className="mx-auto max-w-5xl">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2"><Clock className="h-5 w-5 text-wa-primary-strong" />
          <h1 className="text-xl font-semibold text-wa-text dark:text-white">Mis tareas</h1></div>
          {isAdmin && <select value={assignee} onChange={(event) => setAssignee(event.target.value)} className="rounded-lg border border-wa-border bg-white px-3 py-2 text-sm dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark">
            <option value="mine">Mis tareas</option>
            {users.filter(user => user.is_active && user.id !== me?.id).map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
            <option value="all">Todo el equipo</option>
          </select>}
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-400">
            {error}
          </div>
        )}

        {isLoading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-wa-muted" />
          </div>
        ) : (
          <div className="grid gap-6 lg:grid-cols-3">
            {sections.map((section) => (
              <section key={section.title}>
                <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">
                  {section.title} ({section.items.length})
                </h2>
                <div className="space-y-3">
                  {section.items.map((task) => (
                    <div key={task.id} className="rounded-xl border border-wa-border bg-white p-4 shadow-sm dark:border-wa-border-dark dark:bg-wa-head-dark">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-wa-text dark:text-wa-text-dark">{task.title}</p>
                          <p className="text-sm text-wa-muted dark:text-wa-muted-dark">{task.lead_name ?? task.lead_id}</p>
                        </div>
                        <span className={`shrink-0 rounded-full px-2 py-1 text-xs font-medium ${task.is_overdue ? 'bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-400' : 'bg-green-100 text-wa-primary-strong dark:bg-green-950/50 dark:text-wa-primary'}`}>
                          {new Date(task.due_at).toLocaleString('es-PE')}
                        </span>
                      </div>

                      {task.description && (
                        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{task.description}</p>
                      )}

                      <div className="mt-3 flex items-center gap-3">
                        <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${PRIORITY_COLORS[task.priority]}`}>
                          {TASK_PRIORITY_LABELS[task.priority]}
                        </span>
                        <button
                          type="button"
                          onClick={() => onOpenChat(task.lead_id)}
                          className="flex items-center gap-1 text-xs font-medium text-wa-primary-strong hover:text-wa-primary-strong"
                        >
                          <MessageSquare className="h-3.5 w-3.5" /> Ir al chat
                        </button>
                        <button
                          type="button"
                          onClick={() => handleComplete(task.id)}
                          disabled={isUpdating}
                          className="flex items-center gap-1 text-xs font-medium text-wa-muted hover:text-wa-primary-strong disabled:opacity-40 dark:text-wa-muted-dark"
                        >
                          <Check className="h-3.5 w-3.5" /> Completar
                        </button>
                      </div>
                    </div>
                  ))}
                  {section.items.length === 0 && (
                    <p className="rounded-xl border border-dashed border-wa-border p-4 text-center text-sm text-wa-muted dark:border-wa-border-dark">
                      Sin tareas
                    </p>
                  )}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
