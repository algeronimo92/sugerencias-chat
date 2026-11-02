import { describe, expect, it } from 'vitest'

import { apiFailure, installFakeApi, networkError } from '../../test/fakeApi'
import client from './client'
import { ApiError, asApiError } from './errors'
import { extractErrorMessage } from '../utils/errors'

const api = installFakeApi()

async function failureOf(request: Promise<unknown>): Promise<unknown> {
  try {
    await request
  } catch (error) {
    return error
  }
  throw new Error('el pedido no falló')
}

describe('ApiError', () => {
  it('el cliente entrega ApiError con status, code y detail del backend', async () => {
    api.current.on('post', '/api/x', { status: 409, data: { detail: 'Ya existe', code: 'conflict' } })

    const error = await failureOf(client.post('/api/x'))

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 409, code: 'conflict', detail: 'Ya existe', isNetwork: false })
  })

  it('lee el detail con forma { code, message }', () => {
    const error = apiFailure(429, { detail: { code: 'ai_quota_exceeded', message: 'Sin cuota' } })
    expect(error).toMatchObject({ status: 429, code: 'ai_quota_exceeded', detail: 'Sin cuota' })
  })

  it('un error de validación no se muestra como mensaje', () => {
    const error = apiFailure(422, { detail: [{ loc: ['body', 'name'], msg: 'Field required' }] })
    expect(error.detail).toBeNull()
    expect(extractErrorMessage(error)).toBe('No se pudo completar la operación.')
  })

  it('sin conexión es un ApiError de red', async () => {
    api.current.on('get', '/api/x', () => { throw networkError() })

    const error = await failureOf(client.get('/api/x'))

    expect(asApiError(error)?.isNetwork).toBe(true)
    expect(extractErrorMessage(error)).toMatch(/Sin conexión/)
  })

  it('un 500 sin detalle no muestra el texto de axios', () => {
    expect(extractErrorMessage(apiFailure(500))).toBe('El servidor tuvo un problema. Intentá de nuevo en unos minutos.')
  })

  it('un error que no vino de un pedido no es ApiError', () => {
    expect(asApiError(new Error('otro'))).toBeNull()
    expect(extractErrorMessage(new Error('otro'))).toBe('otro')
  })
})
