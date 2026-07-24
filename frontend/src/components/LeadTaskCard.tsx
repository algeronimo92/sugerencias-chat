import { useState } from 'react'
import { CalendarClock, Check, Loader2, Plus } from 'lucide-react'
import type { Chat, TaskPriority, TaskType } from '../types'
import { useCreateTask, useTasks, useUpdateTask } from '../hooks/useTasks'
import { extractErrorMessage } from '../utils/errors'
import { useMe } from '../hooks/useAuth'
import {
  TASK_TYPE_OPTIONS as TASK_TYPES,
  TASK_PRIORITY_OPTIONS,
  TaskPriorityValue,
  TaskStatusValue,
  TaskTypeValue,
  isTaskPriority,
  isTaskType,
} from '../domain/automationCatalog'
import { Select } from './ui'

export function LeadTaskCard({ chat }: { chat: Chat }) {
  const { data: me } = useMe()
  const { data = [] } = useTasks('pending', chat.chat_id, undefined, me?.role === 'admin')
  const next = data[0]
  const { mutate: create, isPending: isCreating } = useCreateTask()
  const { mutate: update, isPending: isCompleting } = useUpdateTask()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('Seguimiento por WhatsApp')
  const [type, setType] = useState<TaskType>(TaskTypeValue.WhatsApp)
  const [priority, setPriority] = useState<TaskPriority>(TaskPriorityValue.Normal)
  const tomorrow = new Date(Date.now() + 86400000)
  tomorrow.setMinutes(0, 0, 0)
  const localInputValue = (date: Date) => {
    const pad = (value: number) => String(value).padStart(2, '0')
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  const [dueAt, setDueAt] = useState(localInputValue(tomorrow))
  const [error, setError] = useState<string | null>(null)

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    create(
      {
        lead_id: chat.chat_id,
        title,
        task_type: type,
        priority,
        due_at: new Date(dueAt).toISOString(),
        remind_at: new Date(dueAt).toISOString(),
      },
      { onSuccess: () => setOpen(false), onError: (err) => setError(extractErrorMessage(err)) }
    )
  }

  function handleComplete(id: number) {
    setError(null)
    update({ id, status: TaskStatusValue.Completed }, { onError: (err) => setError(extractErrorMessage(err)) })
  }

  return (
    <div className="rounded-xl border border-wa-border bg-white p-3 shadow-sm dark:border-wa-border-dark dark:bg-wa-head-dark">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">
          <CalendarClock className="h-3.5 w-3.5" /> Próxima tarea pendiente
        </div>
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-label="Crear una tarea para este lead"
          title="Crear tarea"
          className="rounded-md p-1 text-wa-muted hover:bg-wa-field hover:text-wa-primary-strong dark:text-wa-muted-dark dark:hover:bg-wa-active-dark"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {next ? (
        <div className="flex items-start justify-between gap-2">
          <div className="flex gap-2">
            <CalendarClock className={`mt-0.5 h-4 w-4 shrink-0 ${next.is_overdue ? 'text-red-500' : 'text-wa-primary-strong'}`} />
            <div>
              <p className="text-sm font-medium text-gray-800 dark:text-wa-text-dark">{next.title}</p>
              <p className={`text-xs ${next.is_overdue ? 'text-red-500' : 'text-wa-muted dark:text-wa-muted-dark'}`}>
                {next.is_overdue ? 'Vencida' : 'Vence'}: {new Date(next.due_at).toLocaleString('es-PE')} · Responsable: {next.assigned_user_name}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleComplete(next.id)}
            disabled={isCompleting}
            aria-label={`Marcar como completada: ${next.title}`}
            title="Marcar tarea como completada"
            className="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-wa-muted hover:bg-wa-field hover:text-wa-primary-strong disabled:opacity-40 dark:text-wa-muted-dark dark:hover:bg-wa-active-dark"
          >
            {isCompleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </button>
        </div>
      ) : (
        <p className="text-xs text-wa-muted">No hay tareas pendientes programadas.</p>
      )}

      {open && (
        <form onSubmit={handleSubmit} className="mt-3 space-y-2 border-t border-wa-border pt-3 dark:border-wa-border-dark">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ej. Llamar para confirmar la cita"
            required
            className="w-full rounded-md border border-wa-border bg-white px-2 py-1.5 text-xs dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
          />
          <p className="text-[11px] text-wa-muted">Se enviará un recordatorio a esa hora.</p>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={type}
              onChange={(event) => { if (isTaskType(event.target.value)) setType(event.target.value) }}
              className="rounded-md border border-wa-border bg-white px-2 py-1.5 text-xs dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
            >
              {TASK_TYPES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </Select>
            <Select
              value={priority}
              onChange={(event) => { if (isTaskPriority(event.target.value)) setPriority(event.target.value) }}
              className="rounded-md border border-wa-border bg-white px-2 py-1.5 text-xs dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
            >
              {TASK_PRIORITY_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </Select>
          </div>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
            required
            className="w-full rounded-md border border-wa-border bg-white px-2 py-1.5 text-xs dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
          />
          <button
            disabled={isCreating}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-wa-primary py-1.5 text-xs font-medium text-white hover:bg-wa-primary-strong disabled:opacity-40"
          >
            {isCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Guardar tarea'}
          </button>
          {error && <p className="text-xs text-red-500">{error}</p>}
        </form>
      )}
    </div>
  )
}
