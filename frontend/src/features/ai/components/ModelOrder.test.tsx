import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AiProvidersStatus } from '../types'
import { ModelOrder } from './ModelOrder'

function status(overrides: Partial<AiProvidersStatus> = {}): AiProvidersStatus {
  return {
    providers: [
      { provider: 'gemini', label: 'Google Gemini', models: ['gemini-3.6-flash'], key_configured: true },
      { provider: 'openai', label: 'OpenAI', models: ['gpt-5.6-terra'], key_configured: true },
    ],
    primary_model: 'gemini:gemini-3.6-flash',
    fallback_model: 'openai:gpt-5.6-terra',
    ready: true,
    model_params: {},
    primary_params: { reasoning: 'high' },
    fallback_params: {},
    ...overrides,
  }
}

describe('ModelOrder', () => {
  it('dice qué modelo procesa y cuál responde si falla', () => {
    render(<ModelOrder status={status()} disabled={false} onSave={vi.fn()} />)
    expect(screen.getByText('Procesa Google Gemini · gemini-3.6-flash; si falla, responde OpenAI · gpt-5.6-terra.')).toBeInTheDocument()
  })

  it('invertir el orden cambia de lugar los dos modelos con sus ajustes, en un solo guardado', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ModelOrder status={status()} disabled={false} onSave={onSave} />)

    await user.click(screen.getByRole('button', { name: /Invertir orden/ }))

    expect(onSave).toHaveBeenCalledOnce()
    expect(onSave.mock.calls[0][0]).toEqual({
      ai_suggestions_primary_model: 'openai:gpt-5.6-terra',
      ai_suggestions_fallback_model: 'gemini:gemini-3.6-flash',
      ai_suggestions_primary_params: '{}',
      ai_suggestions_fallback_params: '{"reasoning":"high"}',
    })
    expect(onSave.mock.calls[0][1]).toBe('Orden invertido: ahora procesa OpenAI · gpt-5.6-terra')
  })

  it('si el que procesa no tiene clave, avisa que hoy responde el de respaldo', () => {
    const providers = [
      { provider: 'gemini', label: 'Google Gemini', models: ['gemini-3.6-flash'], key_configured: false },
      { provider: 'openai', label: 'OpenAI', models: ['gpt-5.6-terra'], key_configured: true },
    ]
    render(<ModelOrder status={status({ providers })} disabled={false} onSave={vi.fn()} />)
    expect(screen.getByText('Google Gemini no tiene clave: hoy procesa OpenAI · gpt-5.6-terra.')).toBeInTheDocument()
  })

  it('elegir como principal el modelo de respaldo invierte el orden en vez de duplicarlo', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn()
    render(<ModelOrder status={status()} disabled={false} onSave={onSave} />)

    await user.click(screen.getByRole('combobox', { name: 'Modelo principal' }))
    await user.click(screen.getByRole('option', { name: /OpenAI · gpt-5.6-terra/ }))

    expect(onSave.mock.calls[0][0]).toMatchObject({
      ai_suggestions_primary_model: 'openai:gpt-5.6-terra',
      ai_suggestions_fallback_model: 'gemini:gemini-3.6-flash',
    })
  })
})
