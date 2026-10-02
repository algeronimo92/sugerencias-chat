/**
 * Cuando el asistente no puede generar, el vendedor tiene que entender por qué
 * y saber si reintentar sirve: nunca un "Request failed with status code 500".
 */

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { AxiosError, AxiosHeaders, type AxiosResponse } from 'axios'
import type { PropsWithChildren } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import client from '../../../shared/http/client'
import { SuggestionError, useGenerateSuggestions } from './useSuggestions'

function wrapper({ children }: PropsWithChildren) {
  const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

function httpError(status: number, data: unknown) {
  const response = { status, data, statusText: '', headers: {}, config: { headers: new AxiosHeaders() } } as AxiosResponse
  return new AxiosError('Request failed with status code ' + status, 'ERR_BAD_RESPONSE', undefined, undefined, response)
}

async function generateAndFail(error: unknown): Promise<SuggestionError> {
  post.mockRejectedValueOnce(error)
  const { result } = renderHook(() => useGenerateSuggestions(), { wrapper })
  act(() => result.current.mutate({ chat_id: 'lead-1', phone: null }))
  await waitFor(() => expect(result.current.isError).toBe(true))
  const failure = result.current.error
  expect(failure).toBeInstanceOf(SuggestionError)
  return failure as SuggestionError
}

let post: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  post = vi.spyOn(client, 'post')
})

afterEach(() => {
  post.mockRestore()
})

describe('useGenerateSuggestions', () => {
  it('explica que se agotó la cuota y no ofrece reintentar', async () => {
    const error = await generateAndFail(httpError(429, {
      detail: { code: 'ai_quota_exceeded', message: 'Tu negocio ya usó las 100 sugerencias de IA incluidas este mes.' },
    }))

    expect(error.message).toBe('Tu negocio ya usó las 100 sugerencias de IA incluidas este mes.')
    expect(error.code).toBe('ai_quota_exceeded')
    expect(error.retryable).toBe(false)
  })

  it.each(['ai_disabled', 'ai_not_configured', 'ai_workflow_rejected'])('trata %s como un aviso sin reintento', async (code) => {
    const error = await generateAndFail(httpError(503, { detail: { code, message: 'Motivo' } }))
    expect(error.retryable).toBe(false)
  })

  it('deja reintentar cuando el workflow falló', async () => {
    const error = await generateAndFail(httpError(502, {
      detail: { code: 'ai_workflow_failed', message: 'El asistente IA no respondió.' },
    }))
    expect(error.message).toBe('El asistente IA no respondió.')
    expect(error.retryable).toBe(true)
  })

  it('nunca muestra el texto técnico de axios en un 500 sin detalle', async () => {
    const error = await generateAndFail(httpError(500, 'Internal Server Error'))

    expect(error.message).not.toMatch(/status code/)
    expect(error.message).toMatch(/no está disponible/)
    expect(error.retryable).toBe(true)
  })
})
