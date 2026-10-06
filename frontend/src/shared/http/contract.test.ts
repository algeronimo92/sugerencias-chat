/**
 * Los tipos del contrato hacen lo que prometen. Las comprobaciones de tipos
 * las verifica `tsc -b` (este archivo entra en la compilación); las de
 * ejecución, vitest.
 */

import { describe, expect, expectTypeOf, it } from 'vitest'

import type { JsonValue } from '../types'
import { oneOf, type ApiResponse, type Delivered, type UntypedResponse } from './contract'

describe('Delivered', () => {
  it('vuelve obligatorios los campos con valor por defecto, que el backend siempre manda', () => {
    expectTypeOf<Delivered<{ a?: string | null; b: number }>>().toEqualTypeOf<{ a: string | null; b: number }>()
  })

  it('lee como JSON lo que el esquema deja en unknown', () => {
    expectTypeOf<Delivered<{ extra: { [key: string]: unknown } }>>().toEqualTypeOf<{ extra: { [key: string]: JsonValue } }>()
  })

  it('recorre listas y objetos anidados', () => {
    expectTypeOf<Delivered<{ items: { id?: number }[] }>>().toEqualTypeOf<{ items: { id: number }[] }>()
  })
})

describe('ApiResponse', () => {
  it('toma la respuesta exitosa de la ruta y el método', () => {
    expectTypeOf<ApiResponse<'/api/chats/{chat_id}', 'get'>['chat_id']>().toEqualTypeOf<string>()
  })

  it('un método que la ruta no tiene no es una respuesta', () => {
    expectTypeOf<ApiResponse<'/api/chats/{chat_id}', 'put'>>().toBeNever()
  })
})

describe('UntypedResponse', () => {
  it('declara la forma de una respuesta que el contrato no tipa', () => {
    expectTypeOf<UntypedResponse<'/api/dashboard', 'get', { total: number }>>().toEqualTypeOf<{ total: number }>()
  })

  it('deja de servir cuando el contrato tipa la respuesta', () => {
    expectTypeOf<UntypedResponse<'/api/chats/{chat_id}', 'get', { total: number }>>().not.toEqualTypeOf<{ total: number }>()
  })
})

describe('oneOf', () => {
  const STATES = ['queued', 'sent'] as const

  it('deja pasar un valor conocido', () => {
    expect(oneOf('sent', STATES)).toBe('sent')
  })

  it('un valor que la app no conoce queda en null', () => {
    expect(oneOf('procesando', STATES)).toBeNull()
    expect(oneOf(null, STATES)).toBeNull()
  })
})
