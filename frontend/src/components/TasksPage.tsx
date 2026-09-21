import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertTriangle, ArrowUp, Bell, CalendarCheck, CalendarClock, CalendarDays, Check, CheckCheck,
  ChevronDown, Clock, FileText, ListTodo, Loader2, MessageCircle, MessageSquare, Phone, RefreshCw,
  RotateCcw, Search, UserRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import {
  TASK_PRIORITY_LABELS, TASK_TYPE_OPTIONS, TaskPriorityValue, TaskStatusValue, TaskTypeValue,
} from '../domain/automationCatalog'
import { useCompleteAllTasks, useTasks, useUpdateTask } from '../hooks/useTasks'
import { useMe } from '../hooks/useAuth'
import { useUsers } from '../hooks/useUsers'
import type { LeadTask, TaskStatus, TaskType } from '../types'
import { isoDateOffset, todayISODate } from '../utils/automationExecutions'
import { cn } from '../utils/cn'
import { extractErrorMessage } from '../utils/errors'
import { Badge } from './ui/Badge'
import { Button } from './ui/Button'
import { ConfirmDialog } from './ui/ConfirmDialog'
import { Input, Select } from './ui/Input'
import { Skeleton } from './ui/Skeleton'
import { StatChip } from './ui/StatChip'
import { STAT_TONE_ICON, type StatTone } from './ui/tones'

/* ---------------------------------------------------------------------------
 * Vocabulario de la pantalla
 *
 * Quien abre "Tareas" quiere tres respuestas: qué se me pasó, qué me toca hoy
 * y a qué chat salto. Por eso la lista es una sola columna ordenada por
 * urgencia (vencidas → hoy → próximas por día) y no tres columnas del mismo
 * peso: en tres columnas lo vencido ocupaba el mismo espacio que lo que vence
 * la semana que viene, y el ancho de escritorio se iba en truncar texto.
 *
 * El backend ya devuelve las pendientes ordenadas por vencimiento (500 máx.),
 * así que el recorte por grupo y la búsqueda se resuelven en memoria: los
 * contadores cuentan sobre el mismo conjunto que se ve y cambiar de grupo no
 * cuesta un viaje de red.
 * ------------------------------------------------------------------------- */

type Bucket = 'overdue' | 'today' | 'upcoming'
type GroupKey = 'all' | Bucket

interface TaskGroup {
  key: GroupKey
  label: string
  /** Qué responde este grupo, en una línea, para el tooltip nativo. */
  hint: string
  /** Título del estado vacío cuando este grupo está seleccionado. */
  emptyTitle: string
  icon: LucideIcon
  tone: StatTone
  matches: (bucket: Bucket) => boolean
}

const TASK_GROUPS: readonly TaskGroup[] = [
  {
    key: 'all', label: 'Todas', hint: 'Todo lo que tienes pendiente.',
    emptyTitle: 'Sin tareas pendientes',
    icon: ListTodo, tone: 'neutral', matches: () => true,
  },
  {
    key: 'overdue', label: 'Vencidas', hint: 'Su fecha ya pasó y siguen sin cerrarse.',
    emptyTitle: 'No tienes tareas vencidas',
    icon: AlertTriangle, tone: 'danger', matches: bucket => bucket === 'overdue',
  },
  {
    key: 'today', label: 'Para hoy', hint: 'Vencen hoy, todavía a tiempo.',
    emptyTitle: 'No te queda nada para hoy',
    icon: CalendarClock, tone: 'warning', matches: bucket => bucket === 'today',
  },
  {
    key: 'upcoming', label: 'Próximas', hint: 'Agendadas para los próximos días.',
    emptyTitle: 'No tienes tareas agendadas más adelante',
    icon: CalendarDays, tone: 'info', matches: bucket => bucket === 'upcoming',
  },
]

const TASK_TYPE_ICONS: Record<TaskType, LucideIcon> = {
  [TaskTypeValue.WhatsApp]: MessageCircle,
  [TaskTypeValue.Call]: Phone,
  [TaskTypeValue.Quote]: FileText,
  [TaskTypeValue.Appointment]: CalendarCheck,
  [TaskTypeValue.FollowUp]: Bell,
  [TaskTypeValue.Other]: ListTodo,
}

const TASK_TYPE_LABELS = Object.fromEntries(
  TASK_TYPE_OPTIONS.map(item => [item.value, item.label]),
) as Record<TaskType, string>

/* ------------------------------------------------------------------ fechas */

/** Clave local 'YYYY-MM-DD' de un instante ISO, para agrupar por día. */
function dayKey(value: string) {
  const date = new Date(value)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function dayLabel(key: string) {
  if (key === todayISODate()) return 'Hoy'
  if (key === isoDateOffset(1)) return 'Mañana'
  if (key === isoDateOffset(-1)) return 'Ayer'
  const [year, month, day] = key.split('-').map(Number)
  const label = new Date(year, month - 1, day).toLocaleDateString('es-PE', {
    weekday: 'long', day: 'numeric', month: 'long',
  })
  return label.charAt(0).toUpperCase() + label.slice(1)
}

function timeLabel(value: string) {
  return new Date(value).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })
}

function fullDateLabel(value: string | null) {
  return value ? new Date(value).toLocaleString('es-PE', { dateStyle: 'full', timeStyle: 'short' }) : 'Sin fecha'
}

/** Cuánto hace que se pasó, en la unidad que el vendedor usaría al hablar. */
function elapsed(due: string) {
  const minutes = Math.max(1, Math.floor((Date.now() - new Date(due).getTime()) / 60_000))
  if (minutes < 60) return { short: `${minutes} min`, long: `hace ${minutes} min` }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { short: `${hours} h`, long: `hace ${hours} h` }
  const days = Math.floor(hours / 24)
  if (days === 1) return { short: '1 día', long: 'ayer' }
  return { short: `${days} días`, long: `hace ${days} días` }
}

function bucketOf(task: LeadTask): Bucket {
  if (task.is_overdue) return 'overdue'
  return dayKey(task.due_at) === todayISODate() ? 'today' : 'upcoming'
}

/** Texto del vencimiento: nunca depende solo del color de la pastilla. */
function dueLabels(task: LeadTask, bucket: Bucket) {
  if (bucket === 'overdue') {
    const { short, long } = elapsed(task.due_at)
    return { badge: short, sentence: `Venció ${long}, ${timeLabel(task.due_at)}` }
  }
  if (bucket === 'today') {
    return { badge: timeLabel(task.due_at), sentence: `Vence hoy ${timeLabel(task.due_at)}` }
  }
  return {
    badge: timeLabel(task.due_at),
    sentence: `Vence ${dayLabel(dayKey(task.due_at)).toLowerCase()} ${timeLabel(task.due_at)}`,
  }
}

/** Los mismos tres tonos que los chips, para que la pastilla de una fila y el
 *  contador de arriba hablen del mismo estado. `neutral` queda descartado a
 *  propósito: su gris sobre gris da 4.1:1, por debajo del mínimo AA. */
const DUE_BADGE_VARIANT: Record<Bucket, 'danger' | 'warning' | 'info'> = {
  overdue: 'danger', today: 'warning', upcoming: 'info',
}

/* ----------------------------------------------------------------- secciones */

interface Section {
  id: string
  title: string
  icon: LucideIcon
  tone: StatTone
  items: LeadTask[]
}

/** Vencidas y Hoy mandan: son secciones propias y van primero. Lo que viene
 *  después se agrupa por día, como el historial de envíos. */
function buildSections(tasks: LeadTask[]): Section[] {
  const overdue: LeadTask[] = []
  const today: LeadTask[] = []
  const upcoming: LeadTask[] = []
  for (const task of tasks) {
    const bucket = bucketOf(task)
    if (bucket === 'overdue') overdue.push(task)
    else if (bucket === 'today') today.push(task)
    else upcoming.push(task)
  }

  const sections: Section[] = []
  if (overdue.length) sections.push({ id: 'overdue', title: 'Vencidas', icon: AlertTriangle, tone: 'danger', items: overdue })
  if (today.length) sections.push({ id: 'today', title: 'Para hoy', icon: CalendarClock, tone: 'warning', items: today })
  for (const task of upcoming) {
    const key = dayKey(task.due_at)
    const last = sections[sections.length - 1]
    if (last && last.id === `day-${key}`) last.items.push(task)
    else sections.push({ id: `day-${key}`, title: dayLabel(key), icon: CalendarDays, tone: 'info', items: [task] })
  }
  return sections
}

function matchesQuery(task: LeadTask, query: string) {
  return [task.title, task.lead_name, task.description, task.assigned_user_name, TASK_TYPE_LABELS[task.task_type]]
    .some(value => value?.toLowerCase().includes(query))
}

/* --------------------------------------------------------------------- fila */

interface RowProps {
  task: LeadTask
  bucket: Bucket
  busy: boolean
  onComplete: () => void
  onOpenChat: () => void
}

function TaskRow({ task, bucket, busy, onComplete, onOpenChat }: RowProps) {
  const TypeIcon = TASK_TYPE_ICONS[task.task_type] ?? ListTodo
  const typeLabel = TASK_TYPE_LABELS[task.task_type] ?? 'Tarea'
  const lead = task.lead_name || task.lead_id
  const due = dueLabels(task, bucket)
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
          aria-label={`Marcar "${task.title}" como completada`}
          title="Marcar como completada"
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full border-2 border-wa-muted text-wa-muted outline-none transition-colors duration-150 hover:border-wa-primary hover:bg-wa-primary hover:text-white focus-visible:ring-2 focus-visible:ring-wa-primary/60 focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-60 dark:border-wa-muted-dark dark:text-wa-muted-dark dark:focus-visible:ring-offset-wa-panel-dark sm:h-10 sm:w-10"
        >
          {busy
            ? <Loader2 className="h-4.5 w-4.5 animate-spin" aria-hidden="true" />
            : <Check className="h-4.5 w-4.5" aria-hidden="true" />}
        </button>

        <span className={cn('min-w-0 flex-1 lg:flex-2', busy && 'opacity-60')}>
          <span className="flex items-center gap-2">
            <TypeIcon className={cn('h-4 w-4 shrink-0', STAT_TONE_ICON.neutral)} aria-hidden="true" />
            {/* El ícono de tipo refuerza, no informa solo: el lector de
                pantalla recibe la palabra y el detalle la repite escrita. */}
            <span className="sr-only">{typeLabel}:</span>
            <span className="truncate text-sm font-semibold text-wa-text dark:text-white">{task.title}</span>
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
          <Badge variant={DUE_BADGE_VARIANT[bucket]} size="md" className="text-xs" title={due.sentence}>
            {bucket === 'overdue'
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
              : <Check className="h-4 w-4" aria-hidden="true" />}
            Completar tarea
          </Button>
        </div>
      </div>
    </details>
  )
}

/* ------------------------------------------------------------------ página */

/** Bandeja de pendientes del vendedor: qué se venció, qué toca hoy y el salto
 *  al chat del lead en un clic. */
export function TasksPage({ onOpenChat }: { onOpenChat: (chatId: string) => void }) {
  const navigate = useNavigate()
  const { data: me } = useMe()
  const isAdmin = me?.role === 'admin'
  const { data: users = [] } = useUsers(!!isAdmin)

  const [assignee, setAssignee] = useState('mine')
  const [group, setGroup] = useState<GroupKey>('all')
  const [search, setSearch] = useState('')

  const allUsers = assignee === 'all'
  const assignedUserId = assignee !== 'mine' && assignee !== 'all' ? Number(assignee) : undefined
  const { data: tasks = [], isLoading, isFetching, isError, error, refetch } =
    useTasks('pending', undefined, assignedUserId, allUsers)
  const updateTask = useUpdateTask()
  const completeAll = useCompleteAllTasks()

  const query = search.trim().toLowerCase()
  const searched = useMemo(
    () => (query ? tasks.filter(task => matchesQuery(task, query)) : tasks),
    [tasks, query],
  )

  const counts = useMemo(() => {
    const result = {} as Record<GroupKey, number>
    for (const item of TASK_GROUPS) {
      result[item.key] = searched.filter(task => item.matches(bucketOf(task))).length
    }
    return result
  }, [searched])

  const activeGroup = TASK_GROUPS.find(item => item.key === group) ?? TASK_GROUPS[0]
  const visible = useMemo(
    () => searched.filter(task => activeGroup.matches(bucketOf(task))),
    [searched, activeGroup],
  )
  const sections = useMemo(() => buildSections(visible), [visible])

  const isFiltered = group !== 'all' || query !== '' || assignee !== 'mine'
  const scopeLabel = assignee === 'mine'
    ? 'Mis tareas'
    : assignee === 'all'
      ? 'Todo el equipo'
      : users.find(user => user.id === assignedUserId)?.name ?? 'Responsable'

  function resetFilters() {
    setGroup('all')
    setSearch('')
    setAssignee('mine')
  }

  function setStatus(id: number, status: TaskStatus, done: () => void) {
    updateTask.mutate({ id, status }, {
      onSuccess: done,
      onError: err => toast.error('No se pudo actualizar la tarea', { description: extractErrorMessage(err) }),
    })
  }

  /** Deshacer en vez de confirmar: completar una tarea es reversible, así que
   *  no vale un modal por delante (Nielsen 3). */
  function handleComplete(task: LeadTask) {
    setStatus(task.id, TaskStatusValue.Completed, () => {
      toast.success('Tarea completada', {
        description: task.title,
        action: {
          label: 'Deshacer',
          onClick: () => setStatus(task.id, TaskStatusValue.Pending, () => toast.success('Tarea devuelta a pendientes')),
        },
      })
    })
  }

  function handleCompleteAll() {
    completeAll.mutate({ assignedUserId, allUsers }, {
      onSuccess: ({ completed }) => toast.success(
        completed === 1 ? '1 tarea completada' : `${completed} tareas completadas`,
      ),
      onError: err => toast.error('No se pudieron completar las tareas', { description: extractErrorMessage(err) }),
    })
  }

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto bg-wa-app dark:bg-wa-app-dark">
      <main className="mx-auto w-full max-w-[1200px] px-4 py-6 pb-10 sm:px-6 lg:px-8 lg:py-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-wa-text dark:text-white">Tareas</h1>
          <p className="mt-1.5 max-w-prose text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
            Revisa qué se venció, qué toca hoy y abre el chat del lead para continuar.
          </p>
        </header>

        {(tasks.length > 0 || isAdmin) && !isError && (
          <section aria-label="Filtros de tareas" className="mt-6 flex flex-col gap-3 rounded-xl border border-wa-border bg-white p-4 sm:flex-row sm:items-end dark:border-wa-border-dark dark:bg-wa-panel-dark">
            {tasks.length > 0 && (
              <label className="block min-w-0 flex-1 text-sm font-medium text-wa-text dark:text-wa-text-dark">
                Buscar tarea o lead
                <span className="relative mt-2 block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
                  <Input type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Nombre, lead o tipo de tarea" className="h-10 w-full border-wa-muted bg-white pl-9 dark:border-wa-muted-dark dark:bg-wa-head-dark" />
                </span>
              </label>
            )}
            {isAdmin && (
              <label className="block min-w-0 text-sm font-medium text-wa-text dark:text-wa-text-dark sm:w-60">
                Responsable
                <Select value={assignee} onChange={event => setAssignee(event.target.value)} className="mt-2 min-h-10 w-full border-wa-muted bg-white shadow-none dark:border-wa-muted-dark dark:bg-wa-head-dark">
                  <option value="mine">Mis tareas</option>
                  {users.filter(user => user.is_active && user.id !== me?.id).map(user => (
                    <option key={user.id} value={user.id}>{user.name}</option>
                  ))}
                  <option value="all">Todo el equipo</option>
                </Select>
              </label>
            )}
          </section>
        )}

        {searched.length > 0 && !isError && (
          <section aria-label="Filtrar por vencimiento" className="mt-5 flex flex-wrap gap-2">
            {TASK_GROUPS.map(item => (
              <StatChip key={item.key} icon={item.icon} label={item.label} hint={item.hint} tone={item.tone} count={counts[item.key] ?? 0} selected={group === item.key} onSelect={() => setGroup(item.key)} compact />
            ))}
          </section>
        )}

        <section className="mt-5" aria-busy={isFetching}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-wa-text dark:text-white">Pendientes</h2>
              <p aria-live="polite" className="mt-0.5 text-sm text-wa-muted dark:text-wa-muted-dark">
                {isLoading
                  ? 'Cargando tareas…'
                  : isError
                    ? 'Listado no disponible'
                    : `${visible.length} ${visible.length === 1 ? 'tarea' : 'tareas'}${isFiltered && tasks.length > 0 ? ` de ${tasks.length}` : ''} · ${scopeLabel}${group === 'all' ? '' : ` · ${activeGroup.label}`}`}
              </p>
            </div>
            <div className="flex items-center gap-1">
              {isFiltered && (
                <Button variant="ghost" size="sm" className="h-9" onClick={resetFilters}>
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  Quitar filtros
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-9" onClick={() => { void refetch() }} aria-busy={isFetching}>
                <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} aria-hidden="true" />
                {isFetching ? 'Actualizando…' : 'Actualizar'}
              </Button>
            </div>
          </div>

          {tasks.length > 0 && !isError && !isLoading && (
            <div className="mb-3 flex flex-col gap-2 rounded-lg border border-wa-border bg-white px-4 py-3 sm:flex-row sm:items-center sm:justify-between dark:border-wa-border-dark dark:bg-wa-panel-dark">
              <p className="text-sm leading-5 text-wa-muted dark:text-wa-muted-dark">
                Completar todas afecta las <strong className="font-semibold text-wa-text dark:text-wa-text-dark">{tasks.length} tareas de {scopeLabel.toLowerCase()}</strong>, incluso las ocultas por filtros.
              </p>
              <ConfirmDialog
                title={`¿Completar las ${tasks.length} tareas pendientes?`}
                description={`Se completarán todas las tareas pendientes de ${scopeLabel.toLowerCase()}, incluso las que el buscador o el grupo seleccionado no muestran. Se quitarán sus recordatorios y no podrás deshacer esta acción.`}
                confirmLabel="Completar todas"
                cancelLabel="Conservar tareas"
                confirmVariant="danger"
                disabled={completeAll.isPending}
                onConfirm={handleCompleteAll}
              >
                <Button variant="secondary" className="h-10 shrink-0" disabled={completeAll.isPending}>
                  {completeAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCheck className="h-4 w-4" aria-hidden="true" />}
                  {completeAll.isPending ? 'Completando…' : 'Completar todas'}
                </Button>
              </ConfirmDialog>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-wa-border bg-white shadow-sm dark:border-wa-border-dark dark:bg-wa-panel-dark">
            {isLoading ? (
              <ul className="divide-y divide-wa-border dark:divide-wa-border-dark">
                {[0, 1, 2, 3, 4].map(index => (
                  <li key={index} className="flex items-center gap-3 px-3 py-3 sm:px-4">
                    <Skeleton className="h-10 w-10 rounded-full" />
                    <div className="min-w-0 flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-52 max-w-full" />
                      <Skeleton className="h-3 w-36 max-w-full" />
                    </div>
                    <Skeleton className="hidden h-5 w-20 rounded-full lg:block" />
                    <Skeleton className="h-9 w-11 rounded-md sm:w-28" />
                  </li>
                ))}
              </ul>
            ) : isError ? (
              <div role="alert" className="flex flex-col items-start gap-3 px-5 py-8 sm:px-6">
                <span className="grid h-11 w-11 place-items-center rounded-full bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300">
                  <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-wa-text dark:text-white">No pudimos cargar tus tareas</p>
                  <p className="mt-1 max-w-lg text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
                    {extractErrorMessage(error)} Prueba de nuevo; si sigue igual, avisa al equipo.
                  </p>
                </div>
                <Button variant="secondary" size="sm" className="h-9" onClick={() => { void refetch() }}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                  Reintentar
                </Button>
              </div>
            ) : visible.length === 0 ? (
              <div className="flex flex-col gap-4 px-5 py-8 sm:flex-row sm:items-start sm:gap-5 sm:px-6">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-wa-field text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark">
                  {isFiltered ? <activeGroup.icon className="h-5 w-5" aria-hidden="true" /> : <CheckCheck className="h-5 w-5" aria-hidden="true" />}
                </span>
                <div className="min-w-0">
                  <h3 className="text-base font-semibold text-wa-text dark:text-wa-text-dark">
                    {isFiltered ? query ? `Ninguna tarea coincide con “${search.trim()}”` : group !== 'all' ? activeGroup.emptyTitle : `Sin tareas para ${scopeLabel.toLowerCase()}` : 'No tienes tareas pendientes'}
                  </h3>
                  <p className="mt-1 max-w-xl text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
                    {isFiltered ? 'Prueba con otro responsable o grupo, o quita los filtros para ver tus pendientes.' : 'Las tareas se crean desde una conversación. Abre un chat para agendar una llamada, cotización o seguimiento.'}
                  </p>
                  <div className="mt-4">
                    {isFiltered ? (
                      <Button variant="secondary" className="h-10" onClick={resetFilters}><RotateCcw className="h-4 w-4" aria-hidden="true" />Quitar filtros</Button>
                    ) : (
                      <Button className="h-10 bg-wa-primary-strong hover:bg-wa-primary-deep" onClick={() => navigate('/')}><MessageSquare className="h-4 w-4" aria-hidden="true" />Ir a los chats</Button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              sections.map(section => {
                const SectionIcon = section.icon
                return (
                  <section key={section.id} aria-label={section.title}>
                    {/* Texto pleno y no gris: sobre el fondo del encabezado el
                        gris se queda en 4.1:1, y además este rótulo es la
                        respuesta a "¿qué se me venció?". */}
                    <h3 className={cn(
                      'flex items-center gap-2 border-b border-wa-border bg-wa-app/60 px-3 py-2 text-xs font-semibold uppercase tracking-wide dark:border-wa-border-dark dark:bg-wa-app-dark/60 sm:px-4',
                      section.tone === 'danger' ? STAT_TONE_ICON.danger : 'text-wa-text dark:text-wa-text-dark',
                    )}>
                      <SectionIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      {section.title}
                      <span className="font-normal normal-case tracking-normal opacity-80">
                        {section.items.length} {section.items.length === 1 ? 'tarea' : 'tareas'}
                      </span>
                    </h3>
                    {section.items.map(task => (
                      <TaskRow
                        key={task.id}
                        task={task}
                        bucket={bucketOf(task)}
                        busy={updateTask.isPending && updateTask.variables?.id === task.id}
                        onComplete={() => handleComplete(task)}
                        onOpenChat={() => onOpenChat(task.lead_id)}
                      />
                    ))}
                  </section>
                )
              })
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
