import { AlertTriangle, ArrowUp, Ban, Check, CheckCheck, ChevronDown, Clock, ListTodo, Loader2, MessageSquare, RotateCcw, UserRound } from 'lucide-react'
import { Badge } from '../../../shared/ui/Badge'
import { Button } from '../../../shared/ui/Button'
import { STAT_TONE_ICON } from '../../../shared/ui/tones'
import { cn } from '../../../shared/utils/cn'
import { TASK_PRIORITY_LABELS, TaskPriorityValue, TaskStatusValue } from '../domain/taskCatalog'
import type { LeadTask } from '../types'
import { DUE_BADGE_VARIANT, TASK_TYPE_ICONS, TASK_TYPE_LABELS, dueLabels, fullDateLabel, isClosed, type Bucket } from './taskListModel'

interface RowProps {
  task: LeadTask
  bucket: Bucket
  busy: boolean
  /** En una pendiente la completa; en una cerrada la devuelve a pendientes. */
  onComplete: () => void
  onOpenChat: () => void
}

export function TaskRow({ task, bucket, busy, onComplete, onOpenChat }: RowProps) {
  const TypeIcon = TASK_TYPE_ICONS[task.task_type] ?? ListTodo
  const typeLabel = TASK_TYPE_LABELS[task.task_type] ?? 'Tarea'
  const lead = task.lead_name || task.lead_id
  const closed = isClosed(task)
  const canceled = task.status === TaskStatusValue.Canceled
  const closedLabel = canceled ? 'Cancelada' : 'Completada'
  const due = closed
    ? { badge: closedLabel, sentence: `${closedLabel}${task.completed_at ? ` el ${fullDateLabel(task.completed_at)}` : ''}` }
    : dueLabels(task, bucket)
  const toggleLabel = closed ? 'Devolver a pendientes' : 'Marcar como completada'
  const high = task.priority === TaskPriorityValue.High

  // Los botones viven dentro del <summary>: sin preventDefault, activarlos
  // además abriría o cerraría el detalle.
  function act(run: () => void) {
    return (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      event.preventDefault()
      event.stopPropagation()
      run()
    }
  }

  return (
    <details className="group border-b border-wa-border last:border-b-0 dark:border-wa-border-dark">
      <summary
        className="flex scroll-mt-4 cursor-pointer list-none items-center gap-2.5 px-3 py-2.5 outline-none transition-colors duration-150 hover:bg-wa-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wa-primary/70 dark:hover:bg-wa-head-dark sm:gap-3 sm:px-4 [&::-webkit-details-marker]:hidden"
        aria-busy={busy}
      >
        <button
          type="button"
          onClick={act(onComplete)}
          disabled={busy}
          aria-label={closed ? `Devolver "${task.title}" a pendientes` : `Marcar "${task.title}" como completada`}
          title={toggleLabel}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-wa-muted text-wa-muted outline-none transition-colors duration-150 hover:border-wa-primary hover:bg-wa-primary hover:text-white focus-visible:ring-2 focus-visible:ring-wa-primary/60 focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60 dark:border-wa-muted-dark dark:text-wa-muted-dark dark:focus-visible:ring-offset-wa-panel-dark sm:h-10 sm:w-10"
        >
          {busy
            ? <Loader2 className="h-4.5 w-4.5 animate-spin" aria-hidden="true" />
            : closed
              ? <RotateCcw className="h-4.5 w-4.5" aria-hidden="true" />
              : <Check className="h-4.5 w-4.5" aria-hidden="true" />}
        </button>

        <span className={cn('min-w-0 flex-1 lg:flex-2', busy && 'opacity-60')}>
          <span className="flex items-center gap-2">
            <TypeIcon className={cn('h-4 w-4 shrink-0', STAT_TONE_ICON.neutral)} aria-hidden="true" />
            {/* El ícono de tipo refuerza, no informa solo: el lector de
                pantalla recibe la palabra y el detalle la repite escrita. */}
            <span className="sr-only">{typeLabel}:</span>
            <span className={cn('truncate text-sm font-semibold text-wa-text dark:text-white', closed && 'line-through decoration-wa-muted/70')}>{task.title}</span>
            {high && (
              <Badge variant="danger" size="md" className="shrink-0 text-xs">
                <ArrowUp className="h-3 w-3" aria-hidden="true" />
                Alta
              </Badge>
            )}
          </span>
          {/* Móvil: lead y vencimiento en palabras, porque no hay columnas. */}
          <span className="mt-0.5 block truncate text-xs text-wa-muted dark:text-wa-muted-dark lg:hidden">
            {lead} · {due.sentence}
          </span>
          {/* Escritorio: la segunda línea aprovecha el ancho con lo que de otro
              modo obligaría a desplegar la fila. */}
          <span className="mt-0.5 hidden truncate text-xs text-wa-muted dark:text-wa-muted-dark lg:block">
            {typeLabel} · {task.assigned_user_name}{task.description ? ` · ${task.description}` : ''}
          </span>
        </span>

        <span className="hidden min-w-0 flex-1 items-center gap-1.5 truncate text-sm text-wa-text dark:text-wa-text-dark lg:flex">
          <UserRound className="h-3.5 w-3.5 shrink-0 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
          <span className="truncate">{lead}</span>
        </span>

        <span className="hidden shrink-0 lg:block lg:w-24">
          <Badge variant={closed ? (canceled ? 'neutral' : 'success') : DUE_BADGE_VARIANT[bucket]} size="md" className="text-xs" title={due.sentence}>
            {closed
              ? (canceled ? <Ban className="h-3 w-3" aria-hidden="true" /> : <CheckCheck className="h-3 w-3" aria-hidden="true" />)
              : bucket === 'overdue'
                ? <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                : <Clock className="h-3 w-3" aria-hidden="true" />}
            {due.badge}
          </Badge>
        </span>

        <Button
          variant="secondary"
          size="sm"
          onClick={act(onOpenChat)}
          aria-label={`Abrir el chat de ${lead}`}
          className="h-11 w-11 shrink-0 px-0 sm:h-9 sm:w-auto sm:px-3"
        >
          <MessageSquare className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Abrir chat</span>
        </Button>

        <ChevronDown className="h-4 w-4 shrink-0 text-wa-muted transition-transform duration-200 group-open:rotate-180 dark:text-wa-muted-dark" aria-hidden="true" />
        <span className="sr-only">Ver detalle de la tarea</span>
      </summary>

      <div className="border-t border-wa-border bg-wa-app px-3 py-4 dark:border-wa-border-dark dark:bg-wa-app-dark sm:px-4">
        {task.description && (
          <p className="mb-3 max-w-prose text-xs leading-5 text-wa-text dark:text-wa-text-dark">{task.description}</p>
        )}
        <dl className="grid max-w-3xl gap-3 text-xs sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <dt className="text-wa-muted dark:text-wa-muted-dark">Vence</dt>
            <dd className="mt-1 font-medium text-wa-text dark:text-white">{fullDateLabel(task.due_at)}</dd>
          </div>
          <div>
            <dt className="text-wa-muted dark:text-wa-muted-dark">Recordatorio</dt>
            <dd className="mt-1 font-medium text-wa-text dark:text-white">
              {task.remind_at ? fullDateLabel(task.remind_at) : 'Sin recordatorio'}
            </dd>
          </div>
          <div>
            <dt className="text-wa-muted dark:text-wa-muted-dark">Responsable</dt>
            <dd className="mt-1 font-medium text-wa-text dark:text-white">{task.assigned_user_name}</dd>
          </div>
          <div>
            <dt className="text-wa-muted dark:text-wa-muted-dark">Tipo y prioridad</dt>
            <dd className="mt-1 font-medium text-wa-text dark:text-white">
              {typeLabel} · Prioridad {TASK_PRIORITY_LABELS[task.priority].toLowerCase()}
            </dd>
          </div>
        </dl>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" className="h-9" onClick={onOpenChat}>
            <MessageSquare className="h-4 w-4" aria-hidden="true" />
            Abrir chat de {lead}
          </Button>
          <Button size="sm" className="h-9" onClick={onComplete} disabled={busy}>
            {busy
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              : closed ? <RotateCcw className="h-4 w-4" aria-hidden="true" /> : <Check className="h-4 w-4" aria-hidden="true" />}
            {closed ? 'Devolver a pendientes' : 'Completar tarea'}
          </Button>
        </div>
      </div>
    </details>
  )
}
