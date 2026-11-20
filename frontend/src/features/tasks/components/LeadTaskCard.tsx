import { Check, Loader2, Plus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { Select } from '../../../shared/ui/Input'
import { PanelSection, PanelSectionAction } from '../../../shared/ui/PanelSection'
import { Tooltip } from '../../../shared/ui/Tooltip'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useMe } from '../../auth/public/queries'
import { TASK_PRIORITY_OPTIONS, TASK_TYPE_OPTIONS as TASK_TYPES, TaskPriorityValue, TaskStatusValue, TaskTypeValue, isTaskPriority, isTaskType } from '../domain/taskCatalog'
import { QUICK_FOLLOW_UPS, quickFollowUpDue, type QuickFollowUp } from '../domain/quickFollowUps'
import type { Chat } from '../../leads/types'
import { useCreateTask, useTasks, useUpdateTask } from '../hooks/useTasks'
import type { TaskPriority, TaskType } from '../types'

// Puras y sin estado: viven en ámbito de módulo para no reconstruirse en
// cada render, lo que además rompía la memoización de los hijos.
const localInputValue = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

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

  function handleQuickFollowUp(option: QuickFollowUp) {
    setError(null)
    const due = quickFollowUpDue(option.id).toISOString()
    create(
      {
        lead_id: chat.chat_id,
        title: 'Seguimiento por WhatsApp',
        task_type: TaskTypeValue.WhatsApp,
        priority: TaskPriorityValue.Normal,
        due_at: due,
        remind_at: due,
      },
      {
        onSuccess: (task) => toast.success(`Te recordaremos el ${new Date(task.due_at).toLocaleString('es-PE', { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`, {
          action: {
            label: 'Deshacer',
            onClick: () => update({ id: task.id, status: TaskStatusValue.Canceled }, { onError: (err) => toast.error(extractErrorMessage(err)) }),
          },
        }),
        onError: (err) => setError(extractErrorMessage(err)),
      },
    )
  }

  // Deshacer en vez de confirmar, igual que en TasksPage: completar es reversible.
  function handleComplete(id: number, title: string) {
    setError(null)
    update({ id, status: TaskStatusValue.Completed }, {
      onSuccess: () => toast.success('Tarea completada', {
        description: title,
        action: {
          label: 'Deshacer',
          onClick: () => update({ id, status: TaskStatusValue.Pending }, { onError: (err) => toast.error(extractErrorMessage(err)) }),
        },
      }),
      onError: (err) => setError(extractErrorMessage(err)),
    })
  }

  return (
    <PanelSection
      title="Seguimiento"
      storageKey="ficha-seccion-seguimiento"
      action={
        <PanelSectionAction label="Crear una tarea para este lead" expanded={open} onClick={() => setOpen(!open)}>
          {open ? <X /> : <Plus />}
        </PanelSectionAction>
      }
    >
      {next ? (
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg">{next.title}</p>
            <p className={`text-xs ${next.is_overdue ? 'font-medium text-danger-fg' : 'text-fg-muted'}`}>
              {next.is_overdue ? 'Vencida' : 'Vence'}: {new Date(next.due_at).toLocaleString('es-PE', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · {next.assigned_user_name}
            </p>
          </div>
          <Tooltip content="Marcar tarea como completada">
            <button
              type="button"
              onClick={() => handleComplete(next.id, next.title)}
              disabled={isCompleting}
              aria-label={`Marcar como completada: ${next.title}`}
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-fg-muted outline-none hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
            >
              {isCompleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </button>
          </Tooltip>
        </div>
      ) : (
        <p className="text-sm text-fg-muted">No hay tareas pendientes.</p>
      )}

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5" role="group" aria-label="Recordar seguimiento">
        <span className="text-xs text-fg-muted">Recordar:</span>
        {QUICK_FOLLOW_UPS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => handleQuickFollowUp(option)}
            disabled={isCreating}
            title={`Crear un seguimiento por WhatsApp ${option.label.toLowerCase()}`}
            className="rounded-full border border-line px-2.5 py-1 text-xs font-medium text-fg outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40"
          >
            {option.label}
          </button>
        ))}
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="mt-3 space-y-2 rounded-lg bg-subtle p-2.5">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Ej. Llamar para confirmar la cita"
            aria-label="Título de la tarea"
            required
            className="w-full rounded-lg border border-line-control bg-surface px-2.5 py-1.5 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <p className="text-xs text-fg-muted">Se enviará un recordatorio a esa hora.</p>
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={type}
              aria-label="Tipo de tarea"
              onChange={(event) => { if (isTaskType(event.target.value)) setType(event.target.value) }}
            >
              {TASK_TYPES.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
            </Select>
            <Select
              value={priority}
              aria-label="Prioridad"
              onChange={(event) => { if (isTaskPriority(event.target.value)) setPriority(event.target.value) }}
            >
              {TASK_PRIORITY_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}
            </Select>
          </div>
          <input
            type="datetime-local"
            value={dueAt}
            aria-label="Vence"
            onChange={(event) => setDueAt(event.target.value)}
            required
            className="w-full rounded-lg border border-line-control bg-surface px-2.5 py-1.5 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <Button type="submit" size="sm" className="w-full" loading={isCreating}>Guardar tarea</Button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger-fg">{error}</p>}
    </PanelSection>
  )
}
