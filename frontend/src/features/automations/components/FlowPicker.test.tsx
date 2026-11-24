/**
 * Smoke test del botón "Iniciar flujo" del chat: que liste los flujos
 * manuales disponibles, que el estado vacío se vea cuando no hay ninguno, y
 * que elegir uno solo lo entregue para confirmar, sin iniciarlo.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { FlowPicker } from './FlowPicker'
import { recentSends } from '../utils/automationExecutions'
import type { AutomationRule } from '../types'

const onChoose = vi.fn()
const CHAT_ID = '7b08f4d9-855f-4718-b95f-9c021da52f77'

vi.mock('../queries', () => ({
  useManualFlows: vi.fn(),
  useAutomationExecutions: vi.fn(),
}))

import { useAutomationExecutions, useManualFlows } from '../queries'

function flow(overrides: Partial<AutomationRule> & { id: number; name: string }): AutomationRule {
  return {
    trigger_type: 'manual',
    trigger_config: {},
    conditions: {},
    max_executions_per_hour: null,
    is_active: true,
    visible_to_sellers: true,
    created_by_user_id: 1,
    created_by_name: 'Admin',
    execution_count: 0,
    flow_definition: { conditions: {}, nodes: [], edges: [] },
    published_flow_definition: null,
    flow_version: 1,
    created_at: '2026-07-20T15:00:00Z',
    updated_at: '2026-07-20T15:00:00Z',
    ...overrides,
  } as AutomationRule
}

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('FlowPicker', () => {
  it('muestra el estado vacío cuando no hay flujos disponibles', async () => {
    vi.mocked(useManualFlows).mockReturnValue({ data: [], isLoading: false } as never)
    vi.mocked(useAutomationExecutions).mockReturnValue({ data: [] } as never)
    const user = userEvent.setup()
    render(<FlowPicker chatId={CHAT_ID} onChoose={onChoose} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'Iniciar un flujo para este lead' }))

    expect(screen.getByText(/No hay flujos disponibles/)).toBeInTheDocument()
  })

  it('lista los flujos y al elegir uno lo entrega para confirmar', async () => {
    vi.mocked(useManualFlows).mockReturnValue({
      data: [flow({ id: 9, name: 'Bienvenida guiada' })],
      isLoading: false,
    } as never)
    vi.mocked(useAutomationExecutions).mockReturnValue({ data: [] } as never)
    const user = userEvent.setup()
    render(<FlowPicker chatId={CHAT_ID} onChoose={onChoose} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'Iniciar un flujo para este lead' }))
    await user.click(screen.getByText('Bienvenida guiada'))

    expect(onChoose).toHaveBeenCalledWith({ id: 9, name: 'Bienvenida guiada' })
    expect(screen.queryByText('Bienvenida guiada')).not.toBeInTheDocument()
  })

  it('deshabilita un flujo que ya tiene una ejecución manual activa', async () => {
    vi.mocked(useManualFlows).mockReturnValue({
      data: [flow({ id: 9, name: 'Bienvenida guiada' })],
      isLoading: false,
    } as never)
    vi.mocked(useAutomationExecutions).mockReturnValue({
      data: [{ id: 1, rule_id: 9, start_source: 'manual', status: 'running' }],
    } as never)
    const user = userEvent.setup()
    render(<FlowPicker chatId={CHAT_ID} onChoose={onChoose} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'Iniciar un flujo para este lead' }))

    expect(screen.getByText('Ya en curso')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Bienvenida guiada/ })).toBeDisabled()
  })

  it('avisa que el lead ya recibió ese flujo y quién lo lanzó, sin bloquearlo', async () => {
    vi.mocked(useManualFlows).mockReturnValue({
      data: [flow({ id: 9, name: 'Hollywood peel' })],
      isLoading: false,
    } as never)
    vi.mocked(useAutomationExecutions).mockReturnValue({
      data: [{
        id: 1, rule_id: 9, start_source: 'flow', status: 'completed', parent_rule_name: 'Bienvenida',
        created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
      }],
    } as never)
    const user = userEvent.setup()
    render(<FlowPicker chatId={CHAT_ID} onChoose={onChoose} />, { wrapper })

    await user.click(screen.getByRole('button', { name: 'Iniciar un flujo para este lead' }))

    expect(screen.getByText('Ya se envió hace 5 min · La lanzó «Bienvenida»')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Hollywood peel/ })).toBeEnabled()
  })
})

describe('recentSends', () => {
  const now = Date.parse('2026-11-24T15:00:00Z')
  const sent = (overrides: object) => ({
    id: 1, rule_id: 9, start_source: 'manual', status: 'completed', started_by_name: 'Ana',
    created_at: '2026-11-24T13:00:00Z', ...overrides,
  }) as never

  it('toma el envío más reciente de cada flujo', () => {
    const notes = recentSends([sent({}), sent({ id: 2, created_at: '2026-11-24T14:59:40Z', start_source: 'system' })], now)
    expect(notes.get(9)).toBe('Ya se envió hace un momento · Empezó sola')
  })

  it('cuenta en horas pasada la primera', () => {
    expect(recentSends([sent({})], now).get(9)).toBe('Ya se envió hace 2 h · La lanzó Ana')
  })

  it('ignora lo que no envió nada y lo de más de un día', () => {
    const notes = recentSends([
      sent({ status: 'failed' }), sent({ status: 'cancelled' }), sent({ status: 'skipped' }),
      sent({ created_at: '2026-11-23T14:00:00Z' }),
    ], now)
    expect(notes.size).toBe(0)
  })
})
