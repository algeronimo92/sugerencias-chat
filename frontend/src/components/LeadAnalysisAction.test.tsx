import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import client from '../api/client'
import { LeadAnalysisAction } from './LeadAnalysisAction'

let post: ReturnType<typeof vi.spyOn>

function renderAction() {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><LeadAnalysisAction chatId="lead-1" /></QueryClientProvider>)
}

beforeEach(() => {
  post = vi.spyOn(client, 'post')
})

afterEach(() => {
  post.mockRestore()
})

describe('LeadAnalysisAction', () => {
  it('pide el análisis del lead y muestra la etapa que aplicó', async () => {
    post.mockResolvedValueOnce({ data: { status: 'ok', applied: true, changed: true, stage: 'calificado' } })
    const user = userEvent.setup()
    renderAction()

    await user.click(screen.getByRole('button', { name: /Analizar con IA/ }))

    expect(post).toHaveBeenCalledWith('/api/suggestions/analyze', { chat_id: 'lead-1' })
    expect(await screen.findByText('Ficha actualizada. Etapa: Calificado.')).toBeInTheDocument()
  })

  it('avisa cuando el análisis no cambió nada', async () => {
    post.mockResolvedValueOnce({ data: { status: 'ok', applied: true, changed: false, stage: null } })
    const user = userEvent.setup()
    renderAction()

    await user.click(screen.getByRole('button', { name: /Analizar con IA/ }))

    expect(await screen.findByText(/Sin cambios/)).toBeInTheDocument()
  })

  it('explica por qué no puede analizar cuando se agotó la cuota', async () => {
    const response = {
      status: 429,
      data: { detail: { code: 'ai_quota_exceeded', message: 'Tu negocio ya usó las 50 sugerencias de IA incluidas este mes.' } },
      statusText: '',
      headers: {},
      config: { headers: new AxiosHeaders() },
    } as AxiosResponse
    post.mockRejectedValueOnce(new AxiosError('Request failed', 'ERR_BAD_REQUEST', undefined, undefined, response))
    const user = userEvent.setup()
    renderAction()

    await user.click(screen.getByRole('button', { name: /Analizar con IA/ }))

    expect(await screen.findByRole('status')).toHaveTextContent('Tu negocio ya usó las 50 sugerencias')
  })
})
