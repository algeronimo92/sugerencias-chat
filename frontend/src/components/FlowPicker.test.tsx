/**
 * Smoke test del botón "Iniciar flujo" del chat: que liste los flujos
 * manuales disponibles, que el estado vacío se vea cuando no hay ninguno, y
 * que elegir uno dispare la mutación con el rule_id y el chat correctos.
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { PropsWithChildren } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { FlowPicker } from './FlowPicker'
import type { AutomationRule } from '../types'

const mutate = vi.fn()
const CHAT_ID = '7b08f4d9-855f-4718-b95f-9c021da52f77'

vi.mock('../hooks/useAutomations', () => ({
  useManualFlows: vi.fn(),
  useStartManualFlow: () => ({ mutate, isPending: false }),
}))

import { useManualFlows } from '../hooks/useAutomations'

function flow(overrides: Partial<AutomationRule> & { id: number; name: string }): AutomationRule {
  return {
    trigger_type: 'manual',
    trigger_config: {},
    conditions: {},
    actions: [],
    delay_minutes: 0,
    max_executions_per_hour: null,
    is_active: true,
    visible_to_sellers: true,
    created_by_user_id: 1,
    created_by_name: 'Admin',
    execution_count: 0,
    builder_mode: 'visual',
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
    const user = userEvent.setup()
    render(<FlowPicker chatId={CHAT_ID} />, { wrapper })

    await user.click(screen.getByTitle('Iniciar un flujo automático para este lead'))

    expect(screen.getByText(/No hay flujos disponibles/)).toBeInTheDocument()
  })

  it('lista los flujos y dispara la mutación al elegir uno', async () => {
    vi.mocked(useManualFlows).mockReturnValue({
      data: [flow({ id: 9, name: 'Bienvenida guiada' })],
      isLoading: false,
    } as never)
    const user = userEvent.setup()
    render(<FlowPicker chatId={CHAT_ID} />, { wrapper })

    await user.click(screen.getByTitle('Iniciar un flujo automático para este lead'))
    await user.click(screen.getByText('Bienvenida guiada'))

    expect(mutate).toHaveBeenCalledWith(
      { ruleId: 9, chatId: CHAT_ID },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
  })
})
