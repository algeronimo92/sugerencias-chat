import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createTestQueryClient, queryWrapper } from '../../../../test/queryWrapper'
import { installFakeApi } from '../../../../test/fakeApi'
import { EMPTY_CHAT_FILTERS, type ChatFilters } from '../../../leads/types'
import type { ChatFiltersState, ChatQuickFilter } from '../../layoutContext'
import { InboxPanel } from './InboxPanel'

const api = installFakeApi()

// Con la suite entera en paralelo, la primera respuesta de la API falsa llega
// después del segundo que espera `findBy` por defecto.
const SLOW = { timeout: 5000 }

const COUNTS = {
  all: 46, unread: 9, mine: 12, unassigned: 4, open: 30, closed: 16, waiting: 7,
  stages: { nuevo: 18, calificado: 6 },
}
const STAGES = [
  { key: 'nuevo', name: 'Nuevo', color: '#0ea5e9', position: 0, kind: 'open', is_active: true },
  { key: 'calificado', name: 'Calificado', color: '#06b6d4', position: 1, kind: 'open', is_active: true },
]

function Harness({ role, advanced = EMPTY_CHAT_FILTERS, onAdvanced }: { role: string; advanced?: ChatFilters; onAdvanced?: (filters: ChatFilters) => void }) {
  const [chatFilter, setChatFilter] = useState<ChatQuickFilter>('all')
  const [advancedFilters, setAdvancedFilters] = useState<ChatFilters>(advanced)
  const filters = {
    chatFilter,
    setChatFilter,
    advancedFilters,
    setAdvancedFilters: (value: ChatFilters) => { setAdvancedFilters(value); onAdvanced?.(value) },
  } as unknown as ChatFiltersState
  return <InboxPanel role={role} filters={filters} onCollapse={() => {}} />
}

function renderPanel(props: Parameters<typeof Harness>[0]) {
  return render(<Harness {...props} />, { wrapper: queryWrapper(createTestQueryClient()) })
}

function item(name: RegExp) {
  return screen.getByRole('button', { name })
}

describe('panel de bandejas', () => {
  beforeEach(() => {
    api.current.on('get', '/api/chats/counts', { data: COUNTS })
    api.current.on('get', '/api/lead-stages', { data: STAGES })
  })

  it('muestra cuántos chats hay en cada bandeja, vista y etapa', async () => {
    renderPanel({ role: 'admin' })

    expect(await screen.findByRole('button', { name: /Sin asignar\s*4/ }, SLOW)).toBeInTheDocument()
    expect(item(/Mías\s*12/)).toBeInTheDocument()
    expect(item(/Todas\s*46/)).toHaveAttribute('aria-pressed', 'true')
    expect(item(/No leídos\s*9/)).toBeInTheDocument()
    expect(item(/Esperando respuesta\s*7/)).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Nuevo\s*18/ }, SLOW)).toBeInTheDocument()
    // Las vistas sin número en el backend no muestran uno inventado.
    expect(item(/Más de 1 h sin responder/)).toHaveTextContent(/^Más de 1 h sin responder$/)
  })

  it('a la vendedora no le ofrece "Todas"', async () => {
    renderPanel({ role: 'vendedor' })

    const section = (await screen.findByRole('button', { name: /Mías/ }, SLOW)).closest('section') as HTMLElement
    expect(within(section).getAllByRole('button').map((button) => button.textContent?.replace(/\d+$/, ''))).toEqual(['Sin asignar', 'Mías'])
  })

  it('tocar una bandeja la selecciona y una etapa filtra solo esa', async () => {
    const onAdvanced = vi.fn()
    renderPanel({ role: 'admin', onAdvanced })

    await userEvent.click(await screen.findByRole('button', { name: /Sin asignar/ }, SLOW))
    expect(item(/Sin asignar/)).toHaveAttribute('aria-pressed', 'true')
    expect(item(/Todas/)).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(await screen.findByRole('button', { name: /Calificado/ }, SLOW))
    expect(onAdvanced).toHaveBeenLastCalledWith(expect.objectContaining({ stages: ['calificado'] }))
    expect(item(/Calificado/)).toHaveAttribute('aria-pressed', 'true')

    // Tocarla otra vez la quita.
    await userEvent.click(item(/Calificado/))
    expect(onAdvanced).toHaveBeenLastCalledWith(expect.objectContaining({ stages: [] }))
  })

  it('"Mis vistas" aplica, quita y guarda vistas propias en el panel', async () => {
    localStorage.setItem('chat-views:v1', JSON.stringify([{ id: 'custom-1', label: 'Botox calientes', filters: { service: 'botox' } }]))
    const onAdvanced = vi.fn()
    renderPanel({ role: 'admin', onAdvanced })

    await userEvent.click(await screen.findByRole('button', { name: 'Botox calientes' }, SLOW))
    expect(onAdvanced).toHaveBeenLastCalledWith(expect.objectContaining({ service: 'botox' }))
    expect(item(/^Botox calientes$/)).toHaveAttribute('aria-pressed', 'true')
    // Ya está guardada tal cual: no se ofrece guardarla otra vez.
    expect(screen.queryByRole('button', { name: 'Guardar vista actual' })).not.toBeInTheDocument()

    // Con otro filtro sí, y se nombra en el lugar.
    await userEvent.click(item(/Calificado/))
    await userEvent.click(screen.getByRole('button', { name: 'Guardar vista actual' }))
    await userEvent.type(screen.getByRole('textbox', { name: 'Nombre de la vista' }), 'Calificados botox{Enter}')
    expect(item(/^Calificados botox$/)).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Quitar la vista Botox calientes' }))
    expect(screen.queryByRole('button', { name: 'Botox calientes' })).not.toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem('chat-views:v1') ?? '[]').map((view: { label: string }) => view.label)).toEqual(['Calificados botox'])
    localStorage.clear()
  })

  it('los números no dependen de la bandeja elegida: solo de etiquetas, servicio y origen', async () => {
    renderPanel({ role: 'admin', advanced: { ...EMPTY_CHAT_FILTERS, stages: ['nuevo'], tagIds: [3], service: 'botox' } })

    await screen.findByRole('button', { name: /Mías\s*12/ }, SLOW)
    const params = api.current.calls('get', '/api/chats/counts').at(-1)?.params
    expect(params).toEqual({ tag_ids: '3', tag_mode: 'any', service: 'botox' })
  })
})
