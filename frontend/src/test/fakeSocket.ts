/**
 * WebSocket falso para los tests: guarda cada conexión abierta y deja al test
 * abrirla, cerrarla y emitir mensajes del servidor a mano.
 */

import { afterEach, beforeEach, vi } from 'vitest'

export class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  closed = false
  sent: string[] = []
  url: string

  // Campo explícito y no propiedad de constructor: el tsconfig usa
  // erasableSyntaxOnly, que prohíbe esa forma abreviada.
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  close() {
    this.closed = true
  }

  /** El servidor aceptó la conexión. */
  open() {
    this.onopen?.()
  }

  /** La conexión se cayó (del lado del servidor o de la red). */
  drop() {
    this.onclose?.()
  }

  emit(payload: object) {
    this.onmessage?.({ data: JSON.stringify(payload) })
  }

  static get last(): FakeWebSocket {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1]
  }
}

/** Reemplaza el WebSocket global por el falso en cada test del archivo. */
export function installFakeSocket() {
  beforeEach(() => {
    FakeWebSocket.instances = []
    vi.stubGlobal('WebSocket', FakeWebSocket)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
  })
}
