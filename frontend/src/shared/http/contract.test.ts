/**
 * Los tipos del contrato hacen lo que prometen. Las comprobaciones de tipos
 * las verifica `tsc -b`: este archivo entra en la compilación.
 */

import { describe, expectTypeOf, it } from 'vitest'

import type { JsonValue } from '../types'
import type { ApiResponse, Delivered } from './contract'

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
