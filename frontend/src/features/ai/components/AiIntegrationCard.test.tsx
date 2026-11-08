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
      { provider: 'gemini', label: 'Google Gemini', models: ['gemini-3.5-flash', 'gemini-3.6-flash'], key_configured: false },
      { provider: 'openai', label: 'OpenAI', models: ['gpt-5.6-terra', 'gpt-5.5'], key_configured: false },
    ],
    primary_model: 'gemini:gemini-3.5-flash',
    fallback_model: 'openai:gpt-5.6-terra',
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

  it('sin claves queda sin configurar y avisa que el chat no tendrá sugerencias', () => {
    render(<AiIntegrationCard />)

    expect(screen.getByText('Sin configurar')).toBeInTheDocument()
    expect(screen.getAllByText('Sin clave')).toHaveLength(2)
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(screen.getByText(/mientras tanto el chat no ofrece sugerencias/)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Probar' })[0]).toBeDisabled()
  })

  it('valida la clave tipeada sin depender del modelo elegido y solo la guarda si el proveedor la acepta', async () => {
    const user = userEvent.setup()
    mocks.test.mockImplementation((_payload: unknown, options: { onSuccess: (r: unknown) => void }) =>
      options.onSuccess({ ok: true, provider: 'gemini', model: null, latency_ms: 820, models_available: 61 }))
    render(<AiIntegrationCard />)

    await user.type(screen.getByLabelText('Google Gemini'), 'AIza-test')
    await user.click(screen.getByRole('button', { name: 'Probar y guardar' }))

    expect(mocks.test).toHaveBeenCalledWith({ provider: 'gemini', apiKey: 'AIza-test', model: null }, expect.any(Object))
    expect(screen.getByRole('status')).toHaveTextContent('Clave válida · 820 ms')
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

  it('con una clave lista queda conectado, sin nada más que activar', () => {
    mocks.status = status({ ready: true, providers: [
      { provider: 'gemini', label: 'Google Gemini', models: ['gemini-3.5-flash'], key_configured: true },
      { provider: 'openai', label: 'OpenAI', models: ['gpt-5.6-terra'], key_configured: false },
    ] })
    render(<AiIntegrationCard />)

    expect(screen.getByText('Conectado · tus claves')).toBeInTheDocument()
    expect(screen.getByText(/Lo consume tu cuenta del proveedor/)).toBeInTheDocument()
    expect(screen.getByText(/análisis automático del lead sigue en el servicio de la plataforma/)).toBeInTheDocument()
  })
})
