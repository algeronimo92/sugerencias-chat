import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { AiIntegrationCard } from './AiIntegrationCard'

const mocks = vi.hoisted(() => ({
  status: null as unknown,
  test: vi.fn(),
  save: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('../hooks/useAiProviders', () => ({
  useAiProviders: () => ({ data: mocks.status, isLoading: false, isError: false }),
  useTestAiProvider: () => ({ mutate: mocks.test, isPending: false }),
  useRefreshAiProviders: () => mocks.refresh,
}))
vi.mock('../../platform/public/useSettings', () => ({
  useSaveSettings: () => ({ mutate: mocks.save, isPending: false }),
}))

function status(overrides: Record<string, unknown> = {}) {
  return {
    providers: [
      { provider: 'gemini', label: 'Google Gemini', models: ['gemini-2.5-flash', 'gemini-2.5-pro'], key_configured: false },
      { provider: 'openai', label: 'OpenAI', models: ['gpt-5.6-terra', 'gpt-5.5'], key_configured: false },
    ],
    primary_model: 'gemini:gemini-2.5-flash',
    fallback_model: 'openai:gpt-5.6-terra',
    suggestions_mode: 'n8n',
    ready: false,
    ...overrides,
  }
}

describe('AiIntegrationCard', () => {
  beforeEach(() => {
    mocks.test.mockReset()
    mocks.save.mockReset()
    mocks.refresh.mockReset()
    mocks.status = status()
  })

  it('sin claves no deja activar el copiloto propio', () => {
    render(<AiIntegrationCard />)

    expect(screen.getByText('Sin configurar')).toBeInTheDocument()
    expect(screen.getAllByText('Sin clave')).toHaveLength(2)
    expect(screen.getByRole('checkbox')).toBeDisabled()
    expect(screen.getByText(/Guarda al menos una clave que pase la prueba/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Probar' })[0]).toBeDisabled()
  })

  it('prueba la clave tipeada contra el modelo elegido y solo la guarda si responde', async () => {
    const user = userEvent.setup()
    mocks.test.mockImplementation((_payload: unknown, options: { onSuccess: (r: unknown) => void }) =>
      options.onSuccess({ ok: true, provider: 'gemini', model: 'gemini-2.5-flash', latency_ms: 820 }))
    render(<AiIntegrationCard />)

    await user.type(screen.getByLabelText('Google Gemini'), 'AIza-test')
    await user.click(screen.getByRole('button', { name: 'Probar y guardar' }))

    expect(mocks.test).toHaveBeenCalledWith({ provider: 'gemini', apiKey: 'AIza-test', model: 'gemini-2.5-flash' }, expect.any(Object))
    expect(screen.getByRole('status')).toHaveTextContent('gemini-2.5-flash responde · 820 ms')
    expect(mocks.save).toHaveBeenCalledWith({ ai_gemini_api_key: 'AIza-test' }, expect.any(Object))
  })

  it('una clave rechazada no se guarda y explica el motivo', async () => {
    const user = userEvent.setup()
    mocks.test.mockImplementation((_payload: unknown, options: { onSuccess: (r: unknown) => void }) =>
      options.onSuccess({ ok: false, provider: 'openai', error: 'OpenAI respondió 401: Incorrect API key' }))
    render(<AiIntegrationCard />)

    await user.type(screen.getByLabelText('OpenAI'), 'sk-mala')
    await user.click(screen.getByRole('button', { name: 'Probar y guardar' }))

    expect(screen.getByRole('alert')).toHaveTextContent('401')
    expect(mocks.save).not.toHaveBeenCalled()
  })

  it('con clave lista se activa y queda conectado', async () => {
    const user = userEvent.setup()
    mocks.status = status({ ready: true, providers: [
      { provider: 'gemini', label: 'Google Gemini', models: ['gemini-2.5-flash'], key_configured: true },
      { provider: 'openai', label: 'OpenAI', models: ['gpt-5.6-terra'], key_configured: false },
    ] })
    const { rerender } = render(<AiIntegrationCard />)

    expect(screen.getByText('Claves listas, sin activar')).toBeInTheDocument()
    await user.click(screen.getByRole('checkbox'))
    expect(mocks.save).toHaveBeenCalledWith({ ai_suggestions_mode: 'native' }, expect.any(Object))

    mocks.status = { ...(mocks.status as object), suggestions_mode: 'native' }
    rerender(<AiIntegrationCard />)
    expect(screen.getByText('Conectado · tus claves')).toBeInTheDocument()
    expect(screen.getByText(/Lo consume tu cuenta del proveedor/)).toBeInTheDocument()
    expect(screen.getByText(/análisis automático del lead sigue en el servicio de la plataforma/)).toBeInTheDocument()
  })

  it('activo sin clave válida se marca con error', () => {
    mocks.status = status({ suggestions_mode: 'native', ready: false })
    render(<AiIntegrationCard />)
    expect(screen.getByText('Falta una clave')).toBeInTheDocument()
  })
})
