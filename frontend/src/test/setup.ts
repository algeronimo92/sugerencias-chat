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
  window.matchMedia = (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

// Tampoco implementa scrollIntoView, que el hilo de mensajes usa al abrir un
// chat o al recibir uno nuevo.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// Radix Select usa pointer capture para distinguir un click de un arrastre.
// jsdom todavía no implementa esa parte de Pointer Events.
if (!Element.prototype.hasPointerCapture) {
  Element.prototype.hasPointerCapture = () => false
}
if (!Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {}
}
if (!Element.prototype.releasePointerCapture) {
  Element.prototype.releasePointerCapture = () => {}
}

// Ni ResizeObserver, del que depende el hilo para re-anclar el scroll cuando
// la media termina de cargar. El doble guarda sus instancias para que los
// tests puedan disparar el callback a mano (jsdom no hace layout, así que
// nunca se dispararía solo).
class ResizeObserverMock implements ResizeObserver {
  static instances: ResizeObserverMock[] = []
  callback: ResizeObserverCallback
  targets = new Set<Element>()

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    ResizeObserverMock.instances.push(this)
  }

  observe(target: Element) {
    this.targets.add(target)
  }

  unobserve(target: Element) {
    this.targets.delete(target)
  }

  disconnect() {
    this.targets.clear()
    const index = ResizeObserverMock.instances.indexOf(this)
    if (index >= 0) ResizeObserverMock.instances.splice(index, 1)
  }
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = ResizeObserverMock
}
