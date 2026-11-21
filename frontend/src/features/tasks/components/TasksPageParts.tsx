import { AlertTriangle, CheckCheck, Loader2, MessageSquare, RefreshCw, RotateCcw, Search } from 'lucide-react'
import { Button } from '../../../shared/ui/Button'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { Input, Select } from '../../../shared/ui/Input'
import { Skeleton } from '../../../shared/ui/Skeleton'
import { StatChip } from '../../../shared/ui/StatChip'
import { STAT_TONE_ICON } from '../../../shared/ui/tones'
import { cn } from '../../../shared/utils/cn'
import { extractErrorMessage } from '../../../shared/utils/errors'
import type { LeadTask } from '../types'
import { TaskRow } from './TaskRow'
import { TASK_GROUPS, bucketOf, type GroupKey, type Section, type TaskGroup } from './taskListModel'

type Person = { id: number; name: string; is_active: boolean }

export function TaskFilters({ showSearch, canChooseAssignee, search, onSearch, assignee, onAssignee, people, meId }: {
  showSearch: boolean
  canChooseAssignee: boolean
  search: string
  onSearch: (value: string) => void
  assignee: string
  onAssignee: (value: string) => void
  people: Person[]
  meId: number | undefined
}) {
  return (
    <section aria-label="Filtros de tareas" className="mt-4 flex flex-col gap-3 rounded-xl border border-wa-border bg-white p-3 sm:mt-6 sm:flex-row sm:items-end sm:p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark">
      {showSearch && (
        <label className="block min-w-0 flex-1 text-sm font-medium text-wa-text dark:text-wa-text-dark">
          Buscar tarea o lead
          <span className="relative mt-2 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
            <Input type="search" value={search} onChange={event => onSearch(event.target.value)} placeholder="Nombre, lead o tipo de tarea" className="h-10 w-full border-wa-muted bg-white pl-9 dark:border-wa-muted-dark dark:bg-wa-head-dark" />
          </span>
        </label>
      )}
      {canChooseAssignee && (
        <label className="block min-w-0 text-sm font-medium text-wa-text dark:text-wa-text-dark sm:w-60">
          Responsable
          <Select value={assignee} onChange={event => onAssignee(event.target.value)} className="mt-2 min-h-10 w-full border-wa-muted bg-white shadow-none dark:border-wa-muted-dark dark:bg-wa-head-dark">
            <option value="mine">Mis tareas</option>
            {people.filter(user => user.is_active && user.id !== meId).map(user => (
              <option key={user.id} value={user.id}>{user.name}</option>
            ))}
            <option value="all">Todo el equipo</option>
          </Select>
        </label>
      )}
    </section>
  )
}

export function TaskGroupChips({ group, counts, onSelect }: { group: GroupKey; counts: Record<GroupKey, number>; onSelect: (group: GroupKey) => void }) {
  return (
    <section aria-label="Filtrar por vencimiento" className="-mx-4 mt-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:mt-5 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>*]:shrink-0">
      {TASK_GROUPS.map(item => (
        <StatChip key={item.key} icon={item.icon} label={item.label} hint={item.hint} tone={item.tone} count={counts[item.key] ?? 0} selected={group === item.key} onSelect={() => onSelect(item.key)} compact />
      ))}
    </section>
  )
}

export function CompleteAllBar({ total, scopeLabel, pending, onConfirm }: { total: number; scopeLabel: string; pending: boolean; onConfirm: () => void }) {
  return (
  <div className="mb-3 flex flex-col gap-2 rounded-lg border border-wa-border bg-white px-3 py-2 sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-3 dark:border-wa-border-dark dark:bg-wa-panel-dark">
    <p className="hidden text-sm leading-5 text-wa-muted sm:block dark:text-wa-muted-dark">
      Completar todas afecta las <strong className="font-semibold text-wa-text dark:text-wa-text-dark">{total} tareas de {scopeLabel.toLowerCase()}</strong>, incluso las ocultas por filtros.
    </p>
    <ConfirmDialog
      title={`¿Completar las ${total} tareas pendientes?`}
      description={`Se completarán todas las tareas pendientes de ${scopeLabel.toLowerCase()}, incluso las que el buscador o el grupo seleccionado no muestran. Se quitarán sus recordatorios y no podrás deshacer esta acción.`}
      confirmLabel="Completar todas"
      cancelLabel="Conservar tareas"
      confirmVariant="danger"
      disabled={pending}
      onConfirm={onConfirm}
    >
      <Button variant="secondary" className="h-10 shrink-0" disabled={pending}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <CheckCheck className="h-4 w-4" aria-hidden="true" />}
        {pending ? 'Completando…' : 'Completar todas'}
      </Button>
    </ConfirmDialog>
  </div>
  )
}

function TaskListSkeleton() {
  return (
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
  )
}

function TaskListError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
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
      <Button variant="secondary" size="sm" className="h-9" onClick={onRetry}>
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
        Reintentar
      </Button>
    </div>
  )
}

/** Título del estado vacío: por qué no hay nada que mostrar. */
function emptyTitle({ isFiltered, query, search, group, scopeLabel }: { isFiltered: boolean; query: string; search: string; group: TaskGroup; scopeLabel: string }) {
  if (!isFiltered) return 'No tienes tareas pendientes'
  if (query) return `Ninguna tarea coincide con “${search.trim()}”`
  if (group.key !== 'all') return group.emptyTitle
  return `Sin tareas para ${scopeLabel.toLowerCase()}`
}

function TaskListEmpty({ isFiltered, query, search, group, scopeLabel, onReset, onGoToChats }: {
  isFiltered: boolean; query: string; search: string; group: TaskGroup; scopeLabel: string; onReset: () => void; onGoToChats: () => void
}) {
  const GroupIcon = group.icon
  return (
    <div className="flex flex-col gap-4 px-5 py-8 sm:flex-row sm:items-start sm:gap-5 sm:px-6">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-wa-field text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark">
        {isFiltered ? <GroupIcon className="h-5 w-5" aria-hidden="true" /> : <CheckCheck className="h-5 w-5" aria-hidden="true" />}
      </span>
      <div className="min-w-0">
        <h3 className="text-base font-semibold text-wa-text dark:text-wa-text-dark">
          {emptyTitle({ isFiltered, query, search, group, scopeLabel })}
        </h3>
        <p className="mt-1 max-w-xl text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
          {isFiltered ? 'Prueba con otro responsable o grupo, o quita los filtros para ver tus pendientes.' : 'Las tareas se crean desde una conversación. Abre un chat para agendar una llamada, cotización o seguimiento.'}
        </p>
        <div className="mt-4">
          {isFiltered ? (
            <Button variant="secondary" className="h-10" onClick={onReset}><RotateCcw className="h-4 w-4" aria-hidden="true" />Quitar filtros</Button>
          ) : (
            <Button className="h-10 bg-wa-primary-strong hover:bg-wa-primary-deep" onClick={onGoToChats}><MessageSquare className="h-4 w-4" aria-hidden="true" />Ir a los chats</Button>
          )}
        </div>
      </div>
    </div>
  )
}

function TaskSections({ sections, busyId, onComplete, onOpenChat }: {
  sections: Section[]; busyId: number | null; onComplete: (task: LeadTask) => void; onOpenChat: (chatId: string) => void
}) {
  return (
    <>
      {sections.map(section => {
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
                busy={busyId === task.id}
                onComplete={() => onComplete(task)}
                onOpenChat={() => onOpenChat(task.lead_id)}
              />
            ))}
          </section>
        )
      })}
    </>
  )
}

export interface TaskListProps {
  isLoading: boolean
  isError: boolean
  error: unknown
  sections: Section[]
  isEmpty: boolean
  isFiltered: boolean
  query: string
  search: string
  group: TaskGroup
  scopeLabel: string
  busyId: number | null
  onRetry: () => void
  onReset: () => void
  onGoToChats: () => void
  onComplete: (task: LeadTask) => void
  onOpenChat: (chatId: string) => void
}

/** Lo que va dentro de la tarjeta de pendientes, según el estado de la lista. */
export function TaskListBody(props: TaskListProps) {
  if (props.isLoading) return <TaskListSkeleton />
  if (props.isError) return <TaskListError error={props.error} onRetry={props.onRetry} />
  if (props.isEmpty) return <TaskListEmpty {...props} />
  return <TaskSections sections={props.sections} busyId={props.busyId} onComplete={props.onComplete} onOpenChat={props.onOpenChat} />
}
