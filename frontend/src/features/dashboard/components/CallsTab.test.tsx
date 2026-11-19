import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { DashboardCalls, DashboardMetrics } from '../types'
import { CallsTab } from './CallsTab'
import { answerRateLabel } from './callsFormat'

type Calls = DashboardCalls

const cause = (key: string, label: string, group: string, count: number, action = 'Haz algo') => ({ cause: key, label, group, action, count })

function calls(overrides: Partial<Calls> = {}): Calls {
  return {
    total: 42, inbound_answered: 30, inbound_missed: 6, quick_hangups: 2, answer_rate: 0.833, outbound_total: 4,
    outbound_answered: 3, avg_duration_seconds: 222, previous_answer_rate: null, missed_by_cause: [], failed_total: 0, failed_by_cause: [],
    failed_by_agent: [], by_hour: [], pending_callbacks: [], ...overrides,
  }
}

function renderTab(value: Calls | undefined, onOpenChat?: (id: string) => void) {
  render(<CallsTab data={{ calls: value } as unknown as DashboardMetrics} days={30} onOpenChat={onOpenChat} />)
}

describe('CallsTab', () => {
  it('sin llamadas en el período lo dice', () => {
    renderTab(calls({ total: 0 }))
    expect(screen.getByText('No hubo llamadas en el período')).toBeInTheDocument()
  })

  it('sin fallos lo dice en vez de esconder el panel', () => {
    renderTab(calls({ inbound_missed: 0 }))
    expect(screen.getByText('Ninguna llamada falló')).toBeInTheDocument()
    expect(screen.getByText('No se perdió ninguna llamada')).toBeInTheDocument()
  })

  it('cada fallo dice cuántos de cuántos, quién lo resuelve y qué hacer', () => {
    renderTab(calls({
      failed_total: 3,
      failed_by_cause: [cause('no_audio', 'No conectó el audio', 'device', 3, 'Prueba otra red')],
    }))
    expect(screen.getByText('No conectó el audio')).toBeInTheDocument()
    expect(screen.getByText('3 de 3')).toBeInTheDocument()
    expect(screen.getByText(/Dispositivo o red de quien atiende/)).toBeInTheDocument()
    expect(screen.getByText(/Prueba otra red/)).toBeInTheDocument()
    expect(screen.getByText(/3 de 42 llamadas/)).toBeInTheDocument()
  })

  it('un problema de la cuenta va arriba, como aviso', () => {
    renderTab(calls({
      failed_total: 1,
      failed_by_cause: [cause('account_paused', 'Meta pausó las llamadas del número', 'account', 1, 'Revisa el motivo en WhatsApp Manager')],
    }))
    expect(screen.getByRole('alert')).toHaveTextContent('Meta pausó las llamadas del número')
  })

  it('cuando los fallos de audio se juntan en una persona, lo dice', () => {
    renderTab(calls({
      failed_total: 11,
      failed_by_cause: [cause('no_audio', 'No conectó el audio', 'device', 11)],
      failed_by_agent: [{ user_id: 2, name: 'Ana', count: 9 }, { user_id: 3, name: 'Bea', count: 2 }],
    }))
    expect(screen.getByText(/9 de 11 fallos de audio fueron de Ana/)).toBeInTheDocument()
  })

  it('las perdidas sin devolver llevan al chat, salvo para quien no abre chats', async () => {
    const user = userEvent.setup()
    const open = vi.fn()
    const pending = { pending_callbacks: [{ chat_id: 'lead-1', ringing_at: '2026-11-19T15:00:00Z' }], missed_by_cause: [cause('no_answer', 'Sonó y nadie atendió', 'team', 6)] }
    renderTab(calls(pending), open)
    await user.click(screen.getByRole('button', { name: /Abrir chat/ }))
    expect(open).toHaveBeenCalledWith('lead-1')
  })

  it('el analista ve las perdidas sin enlace', () => {
    renderTab(calls({ pending_callbacks: [{ chat_id: 'lead-1', ringing_at: '2026-11-19T15:00:00Z' }] }))
    expect(screen.queryByRole('button', { name: /Abrir chat/ })).not.toBeInTheDocument()
  })
})

describe('tasa de atención', () => {
  it('avisa cuando se pierden muchas llamadas, y no con pocas', () => {
    renderTab(calls({ inbound_answered: 6, inbound_missed: 6, answer_rate: 0.5 }))
    expect(screen.getByRole('alert')).toHaveTextContent('Se están perdiendo muchas llamadas')
  })

  it('con pocas llamadas no alarma', () => {
    renderTab(calls({ inbound_answered: 1, inbound_missed: 2, answer_rate: 0.333 }))
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('compara con el período anterior cuando lo hay', () => {
    renderTab(calls({ previous_answer_rate: 0.6 }))
    expect(screen.getByText('Período anterior: 60%')).toBeInTheDocument()
  })
})

describe('answerRateLabel', () => {
  it('con pocas llamadas no muestra porcentaje', () => {
    expect(answerRateLabel({ answer_rate: 0.667, inbound_answered: 2, inbound_missed: 1 })).toBe('2 de 3')
    expect(answerRateLabel({ answer_rate: 0.833, inbound_answered: 30, inbound_missed: 6 })).toBe('83%')
    expect(answerRateLabel({ answer_rate: null, inbound_answered: 0, inbound_missed: 0 })).toBe('—')
  })
})
