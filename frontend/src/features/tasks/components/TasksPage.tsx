import { RefreshCw, RotateCcw } from 'lucide-react'
import { useMemo, useState } from 'react'
import { can } from '../../../shared/permissions'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { cn } from '../../../shared/utils/cn'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useMe } from '../../auth/public/queries'
import { TaskStatusValue } from '../domain/taskCatalog'
import { useUsers } from '../../platform/public/useUsers'
import { useCompleteAllTasks, useTasks, useUpdateTask } from '../hooks/useTasks'
import type { LeadTask, TaskStatus } from '../types'
import { TASK_GROUPS, bucketOf, buildSections, matchesQuery, pendingSummary, type GroupKey } from './taskListModel'
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

/** Búsqueda y grupo sobre las pendientes que ya llegaron: se resuelven en
 *  memoria (ver taskListModel.ts). */
function useTaskView(tasks: LeadTask[], search: string, group: GroupKey) {
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
  return { query, searched, counts, activeGroup, visible, sections }
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

  const { allUsers, assignedUserId } = assigneeScope(assignee)
  const { data: tasks = [], isLoading, isFetching, isError, error, refetch } =
    useTasks('pending', undefined, assignedUserId, allUsers)
  const updateTask = useUpdateTask()
  const completeAll = useCompleteAllTasks()

  const { query, searched, counts, activeGroup, visible, sections } = useTaskView(tasks, search, group)

  const isFiltered = group !== 'all' || query !== '' || assignee !== 'mine'
  const listReady = !isError && !isLoading
  const showCompleteAll = tasks.length > 0 && listReady
  const busyId = updateTask.isPending ? updateTask.variables?.id ?? null : null
  const scopeLabel = scopeLabelFor(assignee, users, assignedUserId)

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

        {(tasks.length > 0 || isAdmin) && !isError && (
          <TaskFilters
            showSearch={tasks.length > 0} canChooseAssignee={isAdmin}
            search={search} onSearch={setSearch} assignee={assignee} onAssignee={setAssignee}
            people={users} meId={me?.id}
          />
        )}

        {searched.length > 0 && !isError && <TaskGroupChips group={group} counts={counts} onSelect={setGroup} />}

        <section className="mt-5" aria-busy={isFetching}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="min-w-0">
              <h2 className="text-base font-semibold text-wa-text dark:text-white">Pendientes</h2>
              <p aria-live="polite" className="mt-0.5 text-sm text-wa-muted dark:text-wa-muted-dark">
                {pendingSummary({ isLoading, isError, visible: visible.length, total: tasks.length, isFiltered, scopeLabel, group: activeGroup })}
              </p>
            </div>
            <PendingActions isFiltered={isFiltered} isFetching={isFetching} onReset={resetFilters} onRefresh={() => { void refetch() }} />
          </div>

          {showCompleteAll && (
            <CompleteAllBar total={tasks.length} scopeLabel={scopeLabel} pending={completeAll.isPending} onConfirm={handleCompleteAll} />
          )}

          <div className="overflow-hidden rounded-xl border border-wa-border bg-white shadow-sm dark:border-wa-border-dark dark:bg-wa-panel-dark">
            <TaskListBody
              isLoading={isLoading} isError={isError} error={error} sections={sections} isEmpty={visible.length === 0}
              isFiltered={isFiltered} query={query} search={search} group={activeGroup} scopeLabel={scopeLabel}
              busyId={busyId}
              onRetry={() => { void refetch() }} onReset={resetFilters} onGoToChats={() => navigate('/')}
              onComplete={handleComplete} onOpenChat={onOpenChat}
            />
          </div>
        </section>
      </main>
    </div>
  )
}
