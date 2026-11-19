import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { CallCenterContext, type CallCenter } from '../callCenterContext'
import type { Call } from '../types'
import { CallCard } from './CallCard'
import { CallDock } from './CallDock'

const call = (overrides: Partial<Call> = {}): Call => ({
  id: 7, chat_id: 'lead-1', direction: 'inbound', status: 'ringing', cause: null, cause_label: null, cause_group: null,
  error_code: null, ringing_at: '2026-11-19T15:00:00Z', accepted_at: null, ended_at: null, duration_seconds: null,
  handled_by_user_id: null, handled_by_name: null, caller_name: 'Josefina', ...overrides,
})

function center(overrides: Partial<CallCenter> = {}): CallCenter {
  return {
    enabled: true, ringing: [], session: { phase: 'idle' }, answer: vi.fn(), dismiss: vi.fn(), hangUp: vi.fn(),
    toggleMute: vi.fn(), clearEnded: vi.fn(), ...overrides,
  }
}

function renderDock(value: CallCenter) {
  render(<MemoryRouter><CallCenterContext.Provider value={value}><CallDock /></CallCenterContext.Provider></MemoryRouter>)
  return value
}

const sessionCall = { id: 7, chatId: 'lead-1', callerName: 'Josefina' }

describe('CallDock', () => {
  it('sin permiso o sin llamadas no muestra nada', () => {
    renderDock(center({ enabled: false, ringing: [call()] }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('una llamada entrante se atiende o se ignora con un toque', async () => {
    const user = userEvent.setup()
    const ringing = call()
    const value = renderDock(center({ ringing: [ringing] }))

    expect(screen.getByRole('alertdialog', { name: 'Llamada entrante de Josefina' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Atender' }))
    expect(value.answer).toHaveBeenCalledWith(ringing)
    await user.click(screen.getByRole('button', { name: 'Ignorar' }))
    expect(value.dismiss).toHaveBeenCalledWith(ringing)
  })

  it('con una llamada en curso, otra entrante se avisa pero no se puede atender', () => {
    renderDock(center({
      ringing: [call({ id: 8, caller_name: 'Carla' })],
      session: { phase: 'active', call: sessionCall, startedAt: Date.now(), muted: false, unstable: false },
    }))

    expect(screen.getByText('Otra llamada')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Atender' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ignorar' })).toBeInTheDocument()
  })

  it('conectando: lo dice y todavía no deja silenciar', () => {
    renderDock(center({ session: { phase: 'connecting', call: sessionCall } }))

    expect(screen.getByText('Conectando…')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Silenciar' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Colgar' })).toBeEnabled()
  })

  it('activa: silenciar y colgar, y el silencio siempre se nota', async () => {
    const user = userEvent.setup()
    const value = renderDock(center({
      session: { phase: 'active', call: sessionCall, startedAt: Date.now(), muted: true, unstable: true },
    }))

    expect(screen.getByText('Micrófono apagado')).toBeInTheDocument()
    expect(screen.getByText('Conexión inestable')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Activar micrófono' }))
    expect(value.toggleMute).toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Colgar' }))
    expect(value.hangUp).toHaveBeenCalled()
  })

  it('al terminar dice qué pasó y ofrece abrir el chat', () => {
    renderDock(center({ session: { phase: 'ended', call: sessionCall, reason: 'no_audio', durationSeconds: null } }))

    expect(screen.getByText('No se pudo conectar el audio. Puede ser la red')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Abrir chat' })).toBeInTheDocument()
  })
})

describe('CallCard', () => {
  it.each([
    [call({ status: 'completed', duration_seconds: 222, handled_by_name: 'Ana' }), 'Llamada entrante · 3:42 · atendió Ana'],
    [call({ status: 'missed', cause: 'no_answer', cause_label: 'Sonó y nadie atendió' }), 'Llamada perdida · Sonó y nadie atendió'],
    [call({ status: 'failed', cause: 'no_audio', cause_label: 'No conectó el audio' }), 'Llamada fallida · No conectó el audio'],
    [call({ status: 'ringing' }), 'Llamada entrante · en curso'],
  ])('%#', (item, text) => {
    render(<CallCard call={item} />)
    expect(screen.getByText(text)).toBeInTheDocument()
  })
})
