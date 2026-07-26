import '@testing-library/jest-dom/vitest'

import { cleanup } from '@testing-library/react'
import { afterEach, vi } from 'vitest'

// Sin esto, el DOM de un test se filtra al siguiente y los `getBy*` empiezan a
// encontrar elementos duplicados de una prueba anterior.
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

// jsdom no implementa matchMedia, y varios componentes lo consultan para
// decidir el layout. Sin este doble, montarlos revienta.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

// Tampoco implementa scrollIntoView, que el hilo de mensajes usa al abrir un
// chat o al recibir uno nuevo.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}
