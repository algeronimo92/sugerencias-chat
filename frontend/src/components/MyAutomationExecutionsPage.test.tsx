/**
 * "Flujos enviados": que los cuatro estados de la vista se dibujen (cargando,
 * error con reintento, vacío con salida al chat y poblado) y que el filtro por
 * estado sea el chip contador — sin pedirle nada nuevo al backend, porque el
 * recorte se hace en memoria sobre el período ya traído.
 */

import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { MyAutomationExecutionsPage } from './MyAutomationExecutionsPage'
import type { AutomationExecution } from '../types'

const navigate = vi.fn()

vi.mock('react-router-dom', () => ({ useNavigate: () => navigate }))

vi.mock('../hooks/useAutomations', () => ({
  useManualFlows: vi.fn(),
  useAutomationExecutions: vi.fn(),
  useCancelExecution: vi.fn(),
}))

import { useAutomationExecutions, useCancelExecution, useManualFlows } from '../hooks/useAutomations'

function execution(overrides: Partial<AutomationExecution> & { id: number }): AutomationExecution {
  const now = new Date().toISOString()
  return {
    rule_id: 1,
    rule_name: 'Bienvenida',
    rule_deleted: false,
    lead_id: 'lead-1',
    lead_name: 'Ana Torres',
    trigger_type: 'manual',
    status: 'completed',
    scheduled_for: now,
    paused_at: null,
    pause_scope: null,
    started_at: now,
    finished_at: now,
    action_results: [],
    flow_state: {},
    error: null,
    created_at: now,
    start_source: 'manual',
    started_by_user_id: 1,
    started_by_name: 'Vendedor',
    window_override_at: null,
    window_override_by_name: null,
    ...overrides,
  } as AutomationExecution
}

function mockQuery(value: Record<string, unknown>) {
  vi.mocked(useManualFlows).mockReturnValue({ data: [] } as never)
  vi.mocked(useCancelExecution).mockReturnValue({ mutate: vi.fn(), isPending: false } as never)
  vi.mocked(useAutomationExecutions).mockReturnValue({
    data: [], isLoading: false, isFetching: false, isError: false, error: null, refetch: vi.fn(),
    ...value,
  } as never)
}

describe('MyAutomationExecutionsPage', () => {
  it('prioriza la salida al chat y permite ampliar el período sin mostrar contadores vacíos', async () => {
    mockQuery({})
    const user = userEvent.setup()
    render(<MyAutomationExecutionsPage />)

    expect(screen.getByText('Todavía no enviaste ningún flujo hoy')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /ir a los chats/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /completados/i })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Ver últimos 7 días' }))
    expect(screen.getByRole('button', { name: '7 días' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('explica el error y deja reintentar', async () => {
    const refetch = vi.fn()
    mockQuery({ isError: true, error: new Error('Sin conexión'), refetch })
    const user = userEvent.setup()
    render(<MyAutomationExecutionsPage />)

    expect(screen.getByRole('alert')).toHaveTextContent('No pudimos cargar tus envíos')
    await user.click(screen.getByRole('button', { name: /reintentar/i }))
    expect(refetch).toHaveBeenCalled()
  })

  it('filtra por grupo desde el chip contador, sin volver a consultar', async () => {
    mockQuery({
      data: [
        execution({ id: 1, status: 'completed', rule_name: 'Bienvenida' }),
        execution({ id: 2, status: 'failed', rule_name: 'Recordatorio', error: 'timeout' }),
      ],
    })
    const user = userEvent.setup()
    render(<MyAutomationExecutionsPage />)

    expect(screen.getByText('Bienvenida')).toBeInTheDocument()
    expect(screen.getByText('Recordatorio')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /completados/i })).toBeInTheDocument()

    const callsBefore = vi.mocked(useAutomationExecutions).mock.calls.length
    const failedChip = screen.getByRole('button', { name: /con error/i })
    expect(within(failedChip).getByText('1')).toBeInTheDocument()

    await user.click(failedChip)

    expect(failedChip).toHaveAttribute('aria-pressed', 'true')
    expect(screen.queryByText('Bienvenida')).not.toBeInTheDocument()
    expect(screen.getByText('Recordatorio')).toBeInTheDocument()
    // Se vuelve a renderizar, pero siempre con los mismos filtros de red.
    const lastArgs = vi.mocked(useAutomationExecutions).mock.calls.at(-1)?.[0]
    const firstArgs = vi.mocked(useAutomationExecutions).mock.calls[callsBefore - 1]?.[0]
    expect(lastArgs).toEqual(firstArgs)
  })

  it('muestra esqueletos mientras carga', () => {
    mockQuery({ isLoading: true })
    render(<MyAutomationExecutionsPage />)

    expect(screen.getByText('Cargando envíos…')).toBeInTheDocument()
  })
})
