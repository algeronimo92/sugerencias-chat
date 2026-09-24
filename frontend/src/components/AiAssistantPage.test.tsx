import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { AIUsage } from '../types'
import { AiAssistantPage } from './AiAssistantPage'

const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn(), patch: vi.fn(), delete: vi.fn() }))

vi.mock('../api/client', () => ({ default: api }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const profile = {
  business_name: 'Clínica Norte',
  business_description: null,
  location: null,
  opening_hours: null,
  currency: 'PEN',
  tone: null,
  always_rules: null,
  never_rules: null,
  updated_at: null,
}

function renderPage() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter><AiAssistantPage /></MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('AiAssistantPage', () => {
  let usage: AIUsage = { enabled: true, monthly_quota: 100, used_this_month: 40, remaining: 60 }

  beforeEach(() => {
    usage = { enabled: true, monthly_quota: 100, used_this_month: 40, remaining: 60 }
    for (const method of Object.values(api)) method.mockReset()
    api.get.mockImplementation((url: string) => {
      if (url === '/api/suggestions/usage') return Promise.resolve({ data: usage })
      if (url === '/api/ai/profile') return Promise.resolve({ data: profile })
      if (url === '/api/ai/knowledge') return Promise.resolve({ data: [] })
      if (url === '/api/media-library') return Promise.resolve({ data: [] })
      return Promise.reject(new Error(`GET inesperado ${url}`))
    })
    api.put.mockImplementation((_url: string, body: object) => Promise.resolve({ data: { ...body, updated_at: null } }))
    api.post.mockImplementation((_url: string, body: { title: string; content: string }) =>
      Promise.resolve({ data: { id: 'doc-1', document_type: null, characters: body.content.length, chunk_count: 1, created_at: '', updated_at: '', ...body } }))
  })

  it('muestra la cuota que fijó la plataforma y guarda el perfil del negocio', async () => {
    const user = userEvent.setup()
    renderPage()

    expect(await screen.findByText('40 de 100 sugerencias este mes')).toBeInTheDocument()
    const name = await screen.findByDisplayValue('Clínica Norte')
    await user.clear(name)
    await user.type(name, 'Clínica Norte Sede 2')
    await user.type(screen.getByLabelText(/El asistente nunca debe/), 'Dar diagnósticos')
    await user.click(screen.getByRole('button', { name: 'Guardar perfil' }))

    await waitFor(() => expect(api.put).toHaveBeenCalledWith('/api/ai/profile', expect.objectContaining({
      business_name: 'Clínica Norte Sede 2',
      currency: 'PEN',
      never_rules: 'Dar diagnósticos',
    })))
  })

  it('avisa cuando el plan no incluye el asistente', async () => {
    usage = { enabled: false, monthly_quota: null, used_this_month: 0, remaining: null }
    renderPage()

    expect(await screen.findByText(/no está incluido en el plan/)).toBeInTheDocument()
  })

  it('crea documentos de conocimiento', async () => {
    const user = userEvent.setup()
    renderPage()

    await user.click(screen.getByRole('button', { name: 'Conocimiento' }))
    await user.click(await screen.findByRole('button', { name: 'Nuevo' }))
    await user.type(screen.getByLabelText('Título'), 'Ficha botox')
    await user.type(screen.getByLabelText('Contenido'), 'Dura 4 meses.')
    await user.click(screen.getByRole('button', { name: 'Guardar documento' }))

    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/api/ai/knowledge', {
      title: 'Ficha botox',
      content: 'Dura 4 meses.',
    }))
  })
})
