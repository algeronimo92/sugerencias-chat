import { RefreshCw, RotateCcw } from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { can } from '../../../shared/permissions'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { usePageSize } from '../../../shared/hooks/usePageSize'
import { Button } from '../../../shared/ui/Button'
import { Pagination } from '../../../shared/ui/Pagination'
import { cn } from '../../../shared/utils/cn'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useMe } from '../../auth/public/queries'
import { TaskStatusValue } from '../domain/taskCatalog'
import { useUsers } from '../../platform/public/useUsers'
import { useCompleteAllTasks, useTasksPage, useUpdateTask } from '../hooks/useTasks'
import type { LeadTask, TaskStatus, TaskStatusFilter } from '../types'
import { STATUS_FILTERS, TASK_GROUPS, buildSections, isClosed, pendingSummary, type GroupKey } from './taskListModel'
import { CompleteAllBar, TaskFilters, TaskGroupChips, TaskListBody } from './TasksPageParts'

function scopeLabelFor(assignee: string, people: { id: number; name: string }[], assignedUserId: number | undefined) {
  if (assignee === 'mine') return 'Mis tareas'
  if (assignee === 'all') return 'Todo el equipo'
  return people.find(user => user.id === assignedUserId)?.name ?? 'Responsable'
}

/** De quién son las tareas que se miran: "mine", "all" o el id de una persona. */
function assigneeScope(assignee: string) {
  const allUsers = assignee === 'all'
  const assignedUserId = assignee !== 'mine' && !allUsers ? Number(assignee) : undefined
  return { allUsers, assignedUserId }
}

/** Medianoche local de mañana, en ISO: hasta ahí llega "Para hoy". La zona
 *  horaria es la del navegador, la misma con la que se agrupa por día. */
function localDayEnd() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString()
}

const EMPTY_COUNTS: Record<GroupKey, number> = { all: 0, overdue: 0, today: 0, upcoming: 0 }

/** Búsqueda, grupo y página se resuelven en el servidor: con más de 500
 *  pendientes la lista en memoria dejaba fuera al resto sin avisar. */
function useTaskView({ status, search, group, assignedUserId, allUsers }: { status: TaskStatusFilter; search: string; group: GroupKey; assignedUserId: number | undefined; allUsers: boolean }) {
  const [pageSize, setPageSize] = usePageSize('tareas:filas')
  const [requestedPage, setRequestedPage] = useState(0)
  const query = useDeferredValue(search.trim())
  const dayEnd = localDayEnd()
  // Otro filtro es otra lista: se vuelve a la primera página.
  useEffect(() => setRequestedPage(0), [status, query, group, assignedUserId, allUsers, pageSize])

  const [knownTotal, setKnownTotal] = useState(0)
  // Si se completan tareas y la última página deja de existir, se muestra la
  // última que quede en vez de una vacía (igual que en embudos).
  const pageCount = Math.max(1, Math.ceil(knownTotal / pageSize))
  const page = Math.min(requestedPage, pageCount - 1)
  const result = useTasksPage({
    dayEnd, status, search: query,
    // Los grupos por vencimiento son de las pendientes: una tarea cerrada no vence.
    bucket: status !== 'pending' || group === 'all' ? undefined : group,
    assignedUserId, allUsers, offset: page * pageSize, limit: pageSize,
  })
  const total = result.data?.total ?? 0
  useEffect(() => setKnownTotal(total), [total])

  const items = useMemo(() => result.data?.items ?? [], [result.data])
  const sections = useMemo(() => buildSections(items), [items])
  return {
    ...result, query, page, pageSize, total, sections, isEmpty: items.length === 0,
    counts: result.data?.counts ?? EMPTY_COUNTS,
    pendingTotal: result.data?.pending_total ?? 0,
    setPage: setRequestedPage, setPageSize,
  }
}

function PendingActions({ isFiltered, isFetching, onReset, onRefresh }: { isFiltered: boolean; isFetching: boolean; onReset: () => void; onRefresh: () => void }) {
  return (
    <div className="flex items-center gap-1">
      {isFiltered && (
        <Button variant="ghost" size="sm" className="h-9" onClick={onReset}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Quitar filtros
        </Button>
      )}
      <Button variant="ghost" size="sm" className="h-9" onClick={onRefresh} aria-busy={isFetching}>
        <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} aria-hidden="true" />
        {isFetching ? 'Actualizando…' : 'Actualizar'}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ página */

/** Bandeja de pendientes del vendedor: qué se venció, qué toca hoy y el salto
 *  al chat del lead en un clic. */
export function TasksPage({ onOpenChat }: { onOpenChat: (chatId: string) => void }) {
  const navigate = useNavigate()
  const { data: me } = useMe()
  // Ver y asignar tareas de otros. La lista de personas sale de Usuarios: se
  // pide si se puede, y solo se usa con team.supervise.
  const isAdmin = can(me, 'team.supervise')
  const { data: users = [] } = useUsers(can(me, 'users.manage'))

  const [assignee, setAssignee] = useState('mine')
  const [group, setGroup] = useState<GroupKey>('all')
  const [search, setSearch] = useState('')
  const [status, setStatusFilter] = useState<TaskStatusFilter>('pending')

  const { allUsers, assignedUserId } = assigneeScope(assignee)
  const {
    isLoading, isFetching, isError, error, refetch, query, page, pageSize, total, sections, isEmpty,
    counts, pendingTotal, setPage, setPageSize,
  } = useTaskView({ status, search, group, assignedUserId, allUsers })
  const updateTask = useUpdateTask()
  const completeAll = useCompleteAllTasks()
  const activeGroup = TASK_GROUPS.find(item => item.key === group) ?? TASK_GROUPS[0]
  const listRef = useRef<HTMLElement>(null)

  const isPendingView = status === 'pending'
  const heading = STATUS_FILTERS.find(item => item.value === status)?.heading ?? 'Pendientes'
  const isFiltered = (isPendingView && group !== 'all') || query !== '' || assignee !== 'mine' || !isPendingView
  const listReady = !isError && !isLoading
  const showCompleteAll = isPendingView && pendingTotal > 0 && listReady
  const busyId = updateTask.isPending ? updateTask.variables?.id ?? null : null
  const scopeLabel = scopeLabelFor(assignee, users, assignedUserId)

  function resetFilters() {
    setGroup('all')
    setSearch('')
    setAssignee('mine')
    setStatusFilter('pending')
  }

  function goToPage(next: number) {
    setPage(next)
    listRef.current?.scrollIntoView({ block: 'start' })
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
    if (isClosed(task)) {
      setStatus(task.id, TaskStatusValue.Pending, () => toast.success('Tarea devuelta a pendientes', { description: task.title }))
      return
    }
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
      {/* En el celular la descripción, los filtros, los contadores y
          "Completar todas" llenaban la primera pantalla y la lista quedaba
          debajo: se compactan para que las tareas se vean sin bajar. */}
      <main className="mx-auto w-full max-w-[1200px] px-4 py-4 pb-10 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-wa-text dark:text-white">Tareas</h1>
          <p className="mt-1.5 hidden max-w-prose text-sm leading-6 text-wa-muted sm:block dark:text-wa-muted-dark">
            Revisa qué se venció, qué toca hoy y abre el chat del lead para continuar.
          </p>
        </header>

        {!isError && (
          <TaskFilters
            showSearch={pendingTotal > 0 || !isPendingView} canChooseAssignee={isAdmin}
            status={status} onStatus={setStatusFilter}
            search={search} onSearch={setSearch} assignee={assignee} onAssignee={setAssignee}
            people={users} meId={me?.id}
          />
        )}

        {isPendingView && counts.all > 0 && !isError && <TaskGroupChips group={group} counts={counts} onSelect={setGroup} />}

        <section ref={listRef} className="mt-5 scroll-mt-4" aria-busy={isFetching}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-wa-text dark:text-white">{heading}</h2>
              <p aria-live="polite" className="mt-0.5 text-sm text-wa-muted dark:text-wa-muted-dark">
                {pendingSummary({ isLoading, isError, visible: total, total: pendingTotal, isFiltered, scopeLabel, group: activeGroup, status })}
              </p>
            </div>
            <PendingActions isFiltered={isFiltered} isFetching={isFetching} onReset={resetFilters} onRefresh={() => { void refetch() }} />
          </div>

          {showCompleteAll && (
            <CompleteAllBar total={pendingTotal} scopeLabel={scopeLabel} pending={completeAll.isPending} onConfirm={handleCompleteAll} />
          )}

          <div className="overflow-hidden rounded-xl border border-wa-border bg-white shadow-sm dark:border-wa-border-dark dark:bg-wa-panel-dark">
            <TaskListBody
              isLoading={isLoading} isError={isError} error={error} sections={sections} isEmpty={isEmpty}
              isFiltered={isFiltered} query={query} search={search} group={activeGroup} scopeLabel={scopeLabel} status={status}
              busyId={busyId}
              onRetry={() => { void refetch() }} onReset={resetFilters} onGoToChats={() => navigate('/')}
              onComplete={handleComplete} onOpenChat={onOpenChat}
            />
            {total > 0 && !isError && (
              <Pagination
                page={page} pageSize={pageSize} total={total} noun={{ one: 'tarea', many: 'tareas' }}
                onPageChange={goToPage} onPageSizeChange={setPageSize}
              />
            )}
          </div>
        </section>
      </main>
    </div>
  )
}
