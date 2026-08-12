/**
 * La regla que usa el Escape global para no cerrar el lead que está debajo de
 * un diálogo. Se apoya en el rol ARIA, así que cualquier modal nuevo queda
 * cubierto sin registrarse en ningún lado.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { hasOpenOverlay } from './overlay'

function mount(html: string) {
  document.body.innerHTML = html
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('hasOpenOverlay', () => {
  it('no ve nada cuando solo está el contenido de la app', () => {
    mount('<main><h1>Chat</h1></main>')

    expect(hasOpenOverlay()).toBe(false)
  })

  it('detecta un diálogo abierto', () => {
    mount('<div role="dialog" aria-modal="true">Vista previa antes de enviar</div>')

    expect(hasOpenOverlay()).toBe(true)
  })

  it('detecta también un confirmar, que usa alertdialog', () => {
    mount('<div role="alertdialog">¿Eliminar?</div>')

    expect(hasOpenOverlay()).toBe(true)
  })

  it('deja de verlo una vez que el diálogo se desmonta', () => {
    mount('<div role="dialog">Vista previa</div>')
    expect(hasOpenOverlay()).toBe(true)

    mount('<main>Chat</main>')

    expect(hasOpenOverlay()).toBe(false)
  })
})
