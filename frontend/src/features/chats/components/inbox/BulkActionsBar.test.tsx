import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestQueryClient, queryWrapper } from '../../../../test/queryWrapper'
import { installFakeApi } from '../../../../test/fakeApi'
import { BulkActionsFooter, BulkSelectionHeader } from './BulkActionsBar'

const api = installFakeApi()

// Con la suite entera en paralelo, la primera respuesta de la API falsa llega
// después del segundo que espera `findBy` por defecto.
const SLOW = { timeout: 5000 }

const STAGES = [
  { key: 'nuevo', name: 'Nuevo', color: '#0ea5e9', position: 0, kind: 'open', is_active: true },
  { key: 'perdido', name: 'Perdido', color: '#f43f5e', position: 1, kind: 'lost', is_active: true },
]

function Harness({ isAdmin, initial }: { isAdmin: boolean; initial: string[] }) {
  const [selected, setSelected] = useState(new Set(initial))
  return (
    <>
      <BulkSelectionHeader selected={selected} visibleIds={['a', 'b', 'c']} onSelectionChange={setSelected} onCancel={() => {}} />
      <BulkActionsFooter selected={selected} onSelectionChange={setSelected} isAdmin={isAdmin} />
    </>
  )
}

function renderBar(props: Parameters<typeof Harness>[0]) {
  return render(<Harness {...props} />, { wrapper: queryWrapper(createTestQueryClient()) })
}

async function choose(menu: string, item: string) {
  await userEvent.click(await screen.findByRole('button', { name: menu }, SLOW))
  await userEvent.click(await screen.findByRole('menuitem', { name: item }, SLOW))
}

describe('acciones masivas de la lista', () => {
  beforeEach(() => {
    api.current.on('get', '/api/lead-stages', { data: STAGES })
    api.current.on('get', '/api/tags', { data: [{ id: 3, name: 'VIP', color: '#e11d48', is_active: true }] })
    api.current.on('get', '/api/chats/sellers', { data: [{ id: 7, name: 'Ana Torres', role: 'vendedor' }] })
  })

  it('sin chats marcados no hay barra de acciones; "Seleccionar todos" marca los visibles', async () => {
    renderBar({ isAdmin: true, initial: [] })

    expect(screen.getByText('Toca los chats para elegirlos')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Mover/ })).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar todos los visibles' }))
    expect(screen.getByText('3 seleccionados')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Mover 3 chats a otra etapa' }, SLOW)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('checkbox', { name: 'Quitar la selección' }))
    expect(screen.getByText('Toca los chats para elegirlos')).toBeInTheDocument()
  })

  it('asigna vendedora a todos y deja seleccionados los que fallaron', async () => {
    api.current.on('patch', '/api/chats/a', { data: {} })
    api.current.on('patch', '/api/chats/b', { status: 404, data: { detail: 'Lead no encontrado' } })
    renderBar({ isAdmin: true, initial: ['a', 'b'] })

    await choose('Asignar vendedora a 2 chats', 'Ana Torres')

    expect(await screen.findByRole('alert', {}, SLOW)).toHaveTextContent('1 chat no se pudo asignar. Siguen seleccionados.')
    expect(screen.getByText('1 seleccionado')).toBeInTheDocument()
    expect(api.current.calls('patch', '/api/chats/a').at(-1)?.body).toEqual({ vendedor_id: 7 })
  })

  it('"Sin asignar" le quita la vendedora', async () => {
    api.current.on('patch', '/api/chats/a', { data: {} })
    renderBar({ isAdmin: true, initial: ['a'] })

    await choose('Asignar vendedora a 1 chat', 'Sin asignar')

    await waitFor(() => expect(api.current.calls('patch', '/api/chats/a').at(-1)?.body).toEqual({ vendedor_id: null }), SLOW)
  })

  it('a la vendedora no le ofrece reasignar', async () => {
    renderBar({ isAdmin: false, initial: ['a'] })

    await screen.findByRole('button', { name: 'Mover 1 chat a otra etapa' }, SLOW)
    expect(screen.queryByRole('button', { name: /Asignar vendedora/ })).not.toBeInTheDocument()
  })

  it('mover a una etapa de perdido pide la razón antes', async () => {
    const onMove = vi.fn(() => ({ data: {} }))
    api.current.on('patch', '/api/chats/a/stage', onMove)
    renderBar({ isAdmin: true, initial: ['a'] })

    await choose('Mover 1 chat a otra etapa', 'Perdido')

    expect(await screen.findByRole('dialog', {}, SLOW)).toBeInTheDocument()
    expect(onMove).not.toHaveBeenCalled()
  })
})
