import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useMetaEmbeddedSignup } from './useMetaEmbeddedSignup'

vi.mock('./useFacebookSdk', () => ({ useFacebookSdk: () => true }))
vi.mock('./useSettings', () => ({
  useMetaPublicConfig: () => ({ data: { app_id: 'APP', config_id: 'CONFIG' }, isLoading: false }),
}))

type LoginParams = Parameters<NonNullable<Window['FB']>['login']>[1]
let loginParams: LoginParams | null = null

beforeEach(() => {
  loginParams = null
  window.FB = {
    init: vi.fn(),
    login: (callback, params) => {
      loginParams = params
      callback({ authResponse: { code: 'CODE' }, status: 'connected' })
    },
  }
})

afterEach(() => {
  delete window.FB
})

function metaFinishes(event: string, data: Record<string, string>) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', {
      origin: 'https://www.facebook.com',
      data: JSON.stringify({ type: 'WA_EMBEDDED_SIGNUP', event, data }),
    }))
  })
}

describe('useMetaEmbeddedSignup', () => {
  it('ofrece la app del celular y avisa que el número sigue ahí', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useMetaEmbeddedSignup(onComplete))

    act(() => result.current.start('business_app'))
    metaFinishes('FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING', { waba_id: 'WABA' })

    expect(loginParams?.extras.featureType).toBe('whatsapp_business_app_onboarding')
    expect(onComplete).toHaveBeenCalledWith({ code: 'CODE', waba_id: 'WABA', phone_number_id: undefined, mode: 'business_app' })
  })

  it('con un número solo para el CRM va directo a elegir cuenta y pide registrarlo', () => {
    const onComplete = vi.fn()
    const { result } = renderHook(() => useMetaEmbeddedSignup(onComplete))

    act(() => result.current.start('cloud_api'))
    metaFinishes('FINISH', { waba_id: 'WABA', phone_number_id: 'PHONE' })

    expect(loginParams?.extras.featureType).toBeUndefined()
    expect(onComplete).toHaveBeenCalledWith({ code: 'CODE', waba_id: 'WABA', phone_number_id: 'PHONE', mode: 'cloud_api' })
  })

  it('el modo sale de lo que Meta informó, no de lo que se eligió antes', () => {
    // La ventana de la app del celular también deja escribir un número nuevo.
    const onComplete = vi.fn()
    const { result } = renderHook(() => useMetaEmbeddedSignup(onComplete))

    act(() => result.current.start('business_app'))
    metaFinishes('FINISH', { waba_id: 'WABA', phone_number_id: 'PHONE' })

    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ mode: 'cloud_api' }))
  })
})
