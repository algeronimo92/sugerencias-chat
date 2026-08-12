/**
 * El panel de automatizaciones del chat: que muestre también las que dispara
 * el sistema (no solo los flujos manuales del vendedor), que cuente cuánto
 * falta para el próximo paso, que una congelada informe el tiempo que la pausa
 * le está guardando, y que cancelar dispare la mutación con esa ejecución.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { LeadAutomationPanel } from './LeadAutomationPanel'
import type { AutomationExecution } from '../types'

const mutate = vi.fn()
const CHAT_ID = '7b08f4d9-855f-4718-b95f-9c021da52f77'
const NOW = new Date('2026-07-20T15:00:00Z')

vi.mock('../hooks/useAutomations', () => ({
  useAutomationExecutions: vi.fn(),
  useCancelExecution: () => ({ mutate, isPending: false, variables: undefined }),
}))

import { useAutomationExecutions } from '../hooks/useAutomations'

function execution(overrides: Partial<AutomationExecution>): AutomationExecution {
  return {
    id: 1,
    rule_id: 5,
    rule_name: 'Cliente sin responder',
    rule_deleted: false,
    lead_id: CHAT_ID,
    lead_name: 'Ana',
    trigger_type: 'customer_response_overdue',
    status: 'scheduled',
    scheduled_for: '2026-07-20T15:30:00Z',
    paused_at: null,
    started_at: null,
    finished_at: null,
    action_results: [],
    flow_state: {},
    error: null,
    created_at: '2026-07-20T14:00:00Z',
    start_source: 'system',
    started_by_user_id: null,
    ...overrides,
  } as AutomationExecution
}

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

describe('LeadAutomationPanel', () => {
  beforeEach(() => {
    mutate.mockClear()
    vi.useFakeTimers({ shouldAdvanceTime: true })
    vi.setSystemTime(NOW)
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('no se dibuja cuando el lead no tiene nada en curso', () => {
    vi.mocked(useAutomationExecutions).mockReturnValue({
      data: [execution({ status: 'completed' })],
    } as never)

    const { container } = render(<LeadAutomationPanel chatId={CHAT_ID} />, { wrapper })

    expect(container).toBeEmptyDOMElement()
  })

  it('muestra una automatización de sistema con lo que falta para el próximo paso', async () => {
    vi.mocked(useAutomationExecutions).mockReturnValue({
      data: [execution({})],
    } as never)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<LeadAutomationPanel chatId={CHAT_ID} />, { wrapper })

    await user.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByText('Automática · Cliente sin responder')).toBeInTheDocument()
    expect(screen.getByText('Continúa en 30 min 0 s')).toBeInTheDocument()
  })

  it('detalla los pasos ya dados, incluida la espera', async () => {
    vi.mocked(useAutomationExecutions).mockReturnValue({
      data: [execution({
        action_results: [
          { position: 1, node_id: 'a1', type: 'send_message', status: 'completed' },
          { position: 2, node_id: 'w1', type: 'wait', status: 'scheduled', seconds: 1800 },
        ],
      })],
    } as never)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<LeadAutomationPanel chatId={CHAT_ID} />, { wrapper })

    await user.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByText(/1\. Enviar mensaje directo/)).toBeInTheDocument()
    expect(screen.getByText(/2\. Pausa/)).toBeInTheDocument()
    expect(screen.getByText(/espera 30 min 0 s/)).toBeInTheDocument()
  })

  it('en una congelada mide lo que falta contra el momento de la pausa', async () => {
    vi.mocked(useAutomationExecutions).mockReturnValue({
      data: [execution({
        status: 'paused',
        // Se congeló faltándole 20 de los 30 minutos originales; que hayan
        // pasado 30 minutos reales desde entonces no le come el tiempo.
        paused_at: '2026-07-20T15:10:00Z',
        scheduled_for: '2026-07-20T15:30:00Z',
      })],
    } as never)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.setSystemTime(new Date('2026-07-20T15:40:00Z'))
    render(<LeadAutomationPanel chatId={CHAT_ID} />, { wrapper })

    await user.click(screen.getByRole('button', { expanded: false }))

    expect(screen.getByText('En pausa · al reanudar le quedan 20 min 0 s')).toBeInTheDocument()
  })

  it('cancela la ejecución elegida', async () => {
    vi.mocked(useAutomationExecutions).mockReturnValue({
      data: [execution({ id: 77 })],
    } as never)
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    render(<LeadAutomationPanel chatId={CHAT_ID} />, { wrapper })

    await user.click(screen.getByRole('button', { expanded: false }))
    await user.click(screen.getByRole('button', { name: 'Cancelar Cliente sin responder' }))

    expect(mutate).toHaveBeenCalledWith(
      77,
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
  })
})
