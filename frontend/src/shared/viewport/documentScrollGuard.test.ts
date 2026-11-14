import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { guardDocumentScroll } from './documentScrollGuard'

// Los dos ejes por separado: jsdom no expande el atajo `overflow` en
// getComputedStyle, el navegador sí.
function box(overflow: string): HTMLDivElement {
  const element = document.createElement('div')
  element.style.overflowX = overflow
  element.style.overflowY = overflow
  return element
}

describe('guardDocumentScroll', () => {
  let remove: () => void = () => {}
  let root: HTMLDivElement
  let appShell: HTMLDivElement

  beforeEach(() => {
    root = box('hidden')
    root.id = 'root'
    appShell = box('hidden')
    root.appendChild(appShell)
    document.body.appendChild(root)
    vi.useFakeTimers()
  })

  afterEach(() => {
    remove()
    root.remove()
    vi.useRealTimers()
  })

  it('no deja que el navegador restaure el desplazamiento al recargar', () => {
    window.history.scrollRestoration = 'auto'
    remove = guardDocumentScroll()
    expect(window.history.scrollRestoration).toBe('manual')
  })

  it('devuelve a cero un contenedor que no se puede desplazar con el dedo', () => {
    remove = guardDocumentScroll()
    const columna = box('hidden')
    appShell.appendChild(columna)
    columna.scrollLeft = 70
    columna.dispatchEvent(new Event('scroll'))
    expect(columna.scrollLeft).toBe(0)
  })

  it('solo en el eje que no se desplaza', () => {
    remove = guardDocumentScroll()
    const pagina = document.createElement('div')
    pagina.style.overflowX = 'hidden'
    pagina.style.overflowY = 'auto'
    appShell.appendChild(pagina)
    pagina.scrollLeft = 40
    pagina.scrollTop = 300
    pagina.dispatchEvent(new Event('scroll'))
    expect([pagina.scrollLeft, pagina.scrollTop]).toEqual([0, 300])
  })

  it('no toca las listas que sí se desplazan', () => {
    remove = guardDocumentScroll()
    const lista = box('auto')
    appShell.appendChild(lista)
    lista.scrollTop = 120
    lista.dispatchEvent(new Event('scroll'))
    expect(lista.scrollTop).toBe(120)
  })

  it('mientras se escribe deja la vista corrida y la acomoda al salir del campo, aunque el campo desaparezca', () => {
    remove = guardDocumentScroll()
    const columna = box('hidden')
    const panel = document.createElement('div')
    const campo = document.createElement('input')
    panel.appendChild(campo)
    columna.appendChild(panel)
    appShell.appendChild(columna)
    campo.focus()

    columna.scrollLeft = 70
    columna.dispatchEvent(new Event('scroll'))
    expect(columna.scrollLeft).toBe(70)

    campo.blur()
    panel.remove()
    vi.runAllTimers()
    expect(columna.scrollLeft).toBe(0)
  })
})
