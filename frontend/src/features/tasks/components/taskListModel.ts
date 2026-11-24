import type { LucideIcon } from 'lucide-react'
import { AlertTriangle, Ban, Bell, CalendarCheck, CalendarClock, CalendarDays, CheckCheck, FileText, ListTodo, MessageCircle, Phone } from 'lucide-react'
import type { StatTone } from '../../../shared/ui/tones'
import { isoDateOffset, todayISODate } from '../../../shared/utils/datetime'
import { TASK_TYPE_OPTIONS, TaskTypeValue } from '../domain/taskCatalog'
import { TaskStatusValue } from '../domain/taskCatalog'
import type { LeadTask, TaskStatusFilter, TaskType } from '../types'

/* ---------------------------------------------------------------------------
 * Vocabulario de la pantalla
 *
 * Quien abre "Tareas" quiere tres respuestas: qué se me pasó, qué me toca hoy
 * y a qué chat salto. Por eso la lista es una sola columna ordenada por
 * urgencia (vencidas → hoy → próximas por día) y no tres columnas del mismo
 * peso: en tres columnas lo vencido ocupaba el mismo espacio que lo que vence
 * la semana que viene, y el ancho de escritorio se iba en truncar texto.
 *
 * La búsqueda, el grupo y la página los resuelve el backend
 * (`/api/tasks/page`), que devuelve las pendientes ordenadas por vencimiento
 * junto con los contadores de cada grupo. Antes se traían 500 y se filtraba
 * en memoria: en un negocio con más de 500 pendientes las demás no se veían.
 * Aquí solo se agrupa por día la página que llegó.
 * ------------------------------------------------------------------------- */

export const STATUS_FILTERS: readonly { value: TaskStatusFilter; label: string; heading: string }[] = [
  { value: 'all', label: 'Todas', heading: 'Todas las tareas' },
  { value: 'pending', label: 'Pendientes', heading: 'Pendientes' },
  { value: 'completed', label: 'Completadas', heading: 'Completadas' },
]

export function isClosed(task: LeadTask) {
  return task.status !== TaskStatusValue.Pending
}

export type Bucket = 'overdue' | 'today' | 'upcoming'
export type GroupKey = 'all' | Bucket

export interface TaskGroup {
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

export const TASK_GROUPS: readonly TaskGroup[] = [
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

export const TASK_TYPE_ICONS: Record<TaskType, LucideIcon> = {
  [TaskTypeValue.WhatsApp]: MessageCircle,
  [TaskTypeValue.Call]: Phone,
  [TaskTypeValue.Quote]: FileText,
  [TaskTypeValue.Appointment]: CalendarCheck,
  [TaskTypeValue.FollowUp]: Bell,
  [TaskTypeValue.Other]: ListTodo,
}

export const TASK_TYPE_LABELS = Object.fromEntries(
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

export function fullDateLabel(value: string | null) {
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

export function bucketOf(task: LeadTask): Bucket {
  if (task.is_overdue) return 'overdue'
  return dayKey(task.due_at) === todayISODate() ? 'today' : 'upcoming'
}

/** Texto del vencimiento: nunca depende solo del color de la pastilla. */
export function dueLabels(task: LeadTask, bucket: Bucket) {
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
export const DUE_BADGE_VARIANT: Record<Bucket, 'danger' | 'warning' | 'info'> = {
  overdue: 'danger', today: 'warning', upcoming: 'info',
}

/* ----------------------------------------------------------------- secciones */

export interface Section {
  id: string
  title: string
  icon: LucideIcon
  tone: StatTone
  items: LeadTask[]
}

/** Vencidas y Hoy mandan: son secciones propias y van primero. Lo que viene
 *  después se agrupa por día, como el historial de envíos. */
export function buildSections(tasks: LeadTask[]): Section[] {
  const overdue: LeadTask[] = []
  const today: LeadTask[] = []
  const upcoming: LeadTask[] = []
  const completed: LeadTask[] = []
  const canceled: LeadTask[] = []
  for (const task of tasks) {
    if (task.status === TaskStatusValue.Completed) { completed.push(task); continue }
    if (task.status === TaskStatusValue.Canceled) { canceled.push(task); continue }
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
  // Las cerradas van al final: el backend ya las manda después de las pendientes.
  if (completed.length) sections.push({ id: 'completed', title: 'Completadas', icon: CheckCheck, tone: 'success', items: completed })
  if (canceled.length) sections.push({ id: 'canceled', title: 'Canceladas', icon: Ban, tone: 'neutral', items: canceled })
  return sections
}

/** "3 tareas de 10 · Mis tareas · Vencidas": qué se ve y de quién. */
export function pendingSummary({ isLoading, isError, visible, total, isFiltered, scopeLabel, group, status = 'pending' }: {
  isLoading: boolean; isError: boolean; visible: number; total: number; isFiltered: boolean; scopeLabel: string; group: TaskGroup; status?: TaskStatusFilter
}) {
  if (isLoading) return 'Cargando tareas…'
  if (isError) return 'Listado no disponible'
  // `total` son las pendientes: "de N" solo tiene sentido mirando pendientes.
  const of = status === 'pending' && isFiltered && total > 0 ? ` de ${total}` : ''
  const inGroup = group.key === 'all' ? '' : ` · ${group.label}`
  return `${visible} ${visible === 1 ? 'tarea' : 'tareas'}${of} · ${scopeLabel}${inGroup}`
}
