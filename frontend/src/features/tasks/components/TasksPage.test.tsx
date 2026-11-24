/**
 * "Tareas": que los cuatro estados de la vista se dibujen (cargando, error con
 * reintento, vacío con salida al chat y poblado), que el chip contador sea el
 * filtro, que lo vencido mande en el orden, que completar sea reversible y que
 * la lista se pagine en el servidor (con +500 pendientes no se pierde ninguna).
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { TasksPage } from './TasksPage'
import type { LeadTask, TaskPageQuery } from '../types'
import { bucketOf } from './taskListModel'

const navigate = vi.fn()

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

vi.mock('../hooks/useTasks', () => ({
  useTasksPage: vi.fn(),
  useUpdateTask: vi.fn(),
  useCompleteAllTasks: vi.fn(),
}))
vi.mock('../../auth/queries', () => ({ useMe: vi.fn() }))
vi.mock('../../platform/hooks/useUsers', () => ({ useUsers: vi.fn() }))

import { useCompleteAllTasks, useTasksPage, useUpdateTask } from '../hooks/useTasks'
import { useMe } from '../../auth/public/queries'
import { useUsers } from '../../platform/public/useUsers'

function hoursFromNow(hours: number) {
  return new Date(Date.now() + hours * 3_600_000).toISOString()
}

function task(overrides: Partial<LeadTask> & { id: number }): LeadTask {
  return {
    lead_id: 'lead-1',
    lead_name: 'Ana Torres',
    title: 'Llamar para cerrar',
    description: null,
    task_type: 'call',
    status: 'pending',
    priority: 'normal',
    due_at: hoursFromNow(2),
    remind_at: null,
    assigned_user_id: 1,
    assigned_user_name: 'Vendedor',
    is_overdue: false,
    created_at: new Date().toISOString(),
    ...overrides,
  } as LeadTask
}

/** El backend en pequeño: búsqueda por título o lead, grupo y página. */
function serverPage(tasks: LeadTask[], query: TaskPageQuery) {
  const term = query.search.toLowerCase()
  const searched = tasks.filter(item => !term || [item.title, item.lead_name].some(value => value?.toLowerCase().includes(term)))
  const counts = { all: searched.length, overdue: 0, today: 0, upcoming: 0 }
  for (const item of searched) counts[bucketOf(item)] += 1
  const inGroup = searched.filter(item => !query.bucket || bucketOf(item) === query.bucket)
  return {
    items: inGroup.slice(query.offset, query.offset + query.limit),
    total: inGroup.length, counts, pending_total: tasks.length,
  }
}

function mockQuery({ data = [], ...value }: Record<string, unknown> & { data?: LeadTask[] }, update: Record<string, unknown> = {}) {
  vi.mocked(useMe).mockReturnValue({ data: { id: 1, role: 'seller' } } as never)
  vi.mocked(useUsers).mockReturnValue({ data: [] } as never)
  vi.mocked(useUpdateTask).mockReturnValue({ mutate: vi.fn(), isPending: false, variables: undefined, ...update } as never)
  vi.mocked(useCompleteAllTasks).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
  vi.mocked(useTasksPage).mockImplementation((query: TaskPageQuery) => ({
    data: value.isLoading || value.isError ? undefined : serverPage(data, query),
    isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn(),
    ...value,
  }) as never)
}

describe('TasksPage', () => {
  // Las secciones dependen de la hora: "dentro de 2 horas" es hoy a mediodía
  // pero mañana a las 23 h. Se fija el reloj (solo Date: userEvent sigue con
  // sus timers reales).
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 9, 6, 12, 0, 0))
  })

  it('ofrece una salida al chat cuando no hay ninguna tarea', () => {
    mockQuery({})
    render(<TasksPage onOpenChat={vi.fn()} />)

    expect(screen.getByText('No tienes tareas pendientes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ir a los chats/i })).toBeInTheDocument()
  })

  it('explica el error de carga y deja reintentar', async () => {
    const refetch = vi.fn()
    mockQuery({ isError: true, error: new Error('Sin conexión'), refetch })
    const user = userEvent.setup()
    render(<TasksPage onOpenChat={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar tus tareas')
    await user.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(refetch).toHaveBeenCalled()
  })

  it('muestra esqueletos mientras carga', () => {
    mockQuery({ isLoading: true })
    render(<TasksPage onOpenChat={vi.fn()} />)

    expect(screen.getByText('Cargando tareas…')).toBeInTheDocument()
  })

  it('pone lo vencido antes que lo de hoy y lo agrupa por sección', () => {
    mockQuery({
      data: [
        task({ id: 1, title: 'Cotización atrasada', is_overdue: true, due_at: hoursFromNow(-30) }),
        task({ id: 2, title: 'Llamada de hoy' }),
      ],
    })
    render(<TasksPage onOpenChat={vi.fn()} />)

    const groups = screen.getAllByRole('heading', { level: 3 }).map(item => item.textContent ?? '')
    expect(groups[0]).toMatch(/Vencidas/)
    expect(groups[1]).toMatch(/Para hoy/)
  })

  it('filtra por grupo desde el chip contador, pidiéndole el grupo al servidor', async () => {
    mockQuery({
      data: [
        task({ id: 1, title: 'Cotización atrasada', is_overdue: true, due_at: hoursFromNow(-30) }),
        task({ id: 2, title: 'Llamada de hoy' }),
      ],
    })
    const user = userEvent.setup()
    render(<TasksPage onOpenChat={vi.fn()} />)

    const chip = screen.getByRole('button', { name: /vencidas/i })
    expect(within(chip).getByText('1')).toBeInTheDocument()

    await user.click(chip)

    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Cotización atrasada')).toBeInTheDocument()
    expect(screen.queryByText('Llamada de hoy')).not.toBeInTheDocument()
    expect(vi.mocked(useTasksPage).mock.calls.at(-1)?.[0]).toMatchObject({ bucket: 'overdue', offset: 0 })
  })

  it('pagina en el servidor y no deja fuera tareas cuando hay muchas', async () => {
    mockQuery({ data: Array.from({ length: 25 }, (_, index) => task({ id: index + 1, title: `Tarea ${index + 1}`, due_at: hoursFromNow(index + 30) })) })
    const user = userEvent.setup()
    render(<TasksPage onOpenChat={vi.fn()} />)

    const pagination = screen.getByRole('navigation', { name: 'Paginación de tareas' })
    expect(pagination).toHaveTextContent('1–10 de 25')
    expect(screen.getByText('Tarea 1')).toBeInTheDocument()
    expect(screen.queryByText('Tarea 11')).not.toBeInTheDocument()

    await user.click(within(pagination).getByRole('button', { name: 'Última página' }))

    expect(vi.mocked(useTasksPage).mock.calls.at(-1)?.[0]).toMatchObject({ offset: 20, limit: 10 })
    expect(pagination).toHaveTextContent('21–25 de 25')
    expect(screen.getByText('Tarea 25')).toBeInTheDocument()
  })

  it('abre el chat del lead desde la fila', async () => {
    const onOpenChat = vi.fn()
    mockQuery({ data: [task({ id: 1, lead_id: 'lead-9', lead_name: 'Ana Torres' })] })
    const user = userEvent.setup()
    render(<TasksPage onOpenChat={onOpenChat} />)

    await user.click(screen.getByRole('button', { name: 'Abrir el chat de Ana Torres' }))
    expect(onOpenChat).toHaveBeenCalledWith('lead-9')
  })

  it('completa una tarea desde la fila sin pedir confirmación', async () => {
    const mutate = vi.fn()
    mockQuery({ data: [task({ id: 7, title: 'Llamar para cerrar' })] }, { mutate })
    const user = userEvent.setup()
    render(<TasksPage onOpenChat={vi.fn()} />)

    await user.click(screen.getByRole('button', { name: 'Marcar "Llamar para cerrar" como completada' }))
    expect(mutate).toHaveBeenCalledWith({ id: 7, status: 'completed' }, expect.anything())
  })

  it('confirma el alcance completo aunque búsqueda y grupo oculten tareas', async () => {
    const mutate = vi.fn()
    mockQuery({ data: [
      task({ id: 1, title: 'Cotización atrasada', is_overdue: true, due_at: hoursFromNow(-30) }),
      task({ id: 2, title: 'Llamada de hoy' }),
    ] })
    vi.mocked(useCompleteAllTasks).mockReturnValue({ mutate, isPending: false } as never)
    const user = userEvent.setup()
    render(<TasksPage onOpenChat={vi.fn()} />)

    await user.type(screen.getByRole('searchbox', { name: 'Buscar tarea o lead' }), 'Cotización')
    await user.click(screen.getByRole('button', { name: /vencidas/i }))
    expect(screen.queryByText('Llamada de hoy')).not.toBeInTheDocument()
    expect(screen.getByText(/2 tareas de mis tareas/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Completar todas' }))
    const dialog = screen.getByRole('alertdialog', { name: '¿Completar las 2 tareas pendientes?' })
    expect(dialog).toHaveTextContent('incluso las que el buscador o el grupo seleccionado no muestran')
    expect(mutate).not.toHaveBeenCalled()
    await user.click(within(dialog).getByRole('button', { name: 'Completar todas' }))
    expect(mutate).toHaveBeenCalledWith({ assignedUserId: undefined, allUsers: false }, expect.any(Object))
  })
})
