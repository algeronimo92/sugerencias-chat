import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestQueryClient, queryWrapper } from '../../../test/queryWrapper'
import { installFakeApi } from '../../../test/fakeApi'
import type { Chat } from '../../leads/types'
import { LeadQuickFields } from './LeadQuickFields'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const api = installFakeApi()

// Con la suite entera en paralelo, la primera respuesta de la API falsa llega
// después del segundo que espera `findBy` por defecto.
const SLOW = { timeout: 5000 }

const STAGES = [
  { key: 'nuevo', name: 'Nuevo', color: '#0ea5e9', position: 0, kind: 'open', is_active: true },
  { key: 'calificado', name: 'Calificado', color: '#06b6d4', position: 1, kind: 'open', is_active: true },
  { key: 'perdido', name: 'Perdido', color: '#f43f5e', position: 2, kind: 'lost', is_active: true },
]

const CHAT = { chat_id: 'lead-1', stage: 'nuevo', vendedor_id: null, vendedor: null } as unknown as Chat

function renderFields(isAdmin: boolean) {
  render(<LeadQuickFields chat={CHAT} isAdmin={isAdmin} />, { wrapper: queryWrapper(createTestQueryClient()) })
}

describe('etapa y vendedora en la cabecera del chat', () => {
  beforeEach(() => {
    api.current.on('get', '/api/lead-stages', { data: STAGES })
    api.current.on('get', '/api/chats/sellers', { data: [{ id: 7, name: 'Ana Torres', role: 'vendedor' }] })
  })

  it('mueve la etapa sin abrir la ficha', async () => {
    api.current.on('patch', '/api/chats/lead-1/stage', { data: {} })
    renderFields(false)

    await userEvent.click(await screen.findByRole('button', { name: 'Etapa: Nuevo. Cambiar etapa' }, SLOW))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Calificado' }, SLOW))

    await waitFor(() => expect(api.current.calls('patch', '/api/chats/lead-1/stage').at(-1)?.body).toMatchObject({ stage: 'calificado' }), SLOW)
  })

  it('pasar a perdido pide la razón antes de moverlo', async () => {
    const onMove = vi.fn(() => ({ data: {} }))
    api.current.on('patch', '/api/chats/lead-1/stage', onMove)
    renderFields(false)

    await userEvent.click(await screen.findByRole('button', { name: /Cambiar etapa/ }, SLOW))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Perdido' }, SLOW))

    expect(await screen.findByRole('dialog', {}, SLOW)).toBeInTheDocument()
    expect(onMove).not.toHaveBeenCalled()
  })

  it('el admin asigna la vendedora; para el resto es solo texto', async () => {
    api.current.on('patch', '/api/chats/lead-1', { data: {} })
    const { unmount } = render(<LeadQuickFields chat={CHAT} isAdmin={false} />, { wrapper: queryWrapper(createTestQueryClient()) })
    expect(screen.getByText('Sin asignar')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Cambiar vendedora/ })).not.toBeInTheDocument()
    unmount()

    renderFields(true)
    await userEvent.click(screen.getByRole('button', { name: 'Vendedora: Sin asignar. Cambiar vendedora' }))
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Ana Torres' }, SLOW))

    await waitFor(() => expect(api.current.calls('patch', '/api/chats/lead-1').at(-1)?.body).toEqual({ vendedor_id: 7 }), SLOW)
  })
})
