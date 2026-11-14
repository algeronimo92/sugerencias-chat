/**
 * Un contenedor con `overflow: hidden` no se puede desplazar con el dedo, pero
 * el navegador sí lo desplaza por código. Lo hace al enfocar un campo que
 * queda fuera de pantalla, cuando el teclado del celular empuja la vista para
 * mostrarlo, o al recargar, porque restaura el desplazamiento de la página.
 * Después nadie lo devuelve, y la interfaz queda corrida sin forma de
 * arreglarla.
 *
 * Pasaba en el celular. Con la página corrida al aplicar una versión nueva,
 * que recarga, la barra inferior quedaba fuera de la pantalla. Al abrir las
 * plantillas del chat, el buscador quedaba fuera de pantalla, el navegador
 * corría un contenedor interno para mostrarlo y se movía toda la interfaz.
 *
 * Regla: la ventana y todo contenedor con `overflow: hidden` o `clip` en un
 * eje vuelven a cero en ese eje. Las listas que sí se desplazan (`auto`,
 * `scroll`) no se tocan. Mientras alguien escribe tampoco: el navegador
 * corre la vista a propósito para que el teclado no tape el campo, y se
 * acomoda al salir de él.
 */

const EDITABLE = 'input, textarea, select, [contenteditable="true"], [contenteditable=""]'
const NOT_SCROLLABLE = new Set(['hidden', 'clip'])

function isEditing(doc: Document): boolean {
  const active = doc.activeElement
  return active instanceof Element && active.matches(EDITABLE)
}

/** Vuelve a cero los ejes en los que el elemento no es desplazable. */
function settle(element: Element): void {
  if (element.scrollLeft === 0 && element.scrollTop === 0) return
  const style = element.ownerDocument.defaultView?.getComputedStyle(element)
  if (!style) return
  if (element.scrollLeft !== 0 && NOT_SCROLLABLE.has(style.overflowX)) element.scrollLeft = 0
  if (element.scrollTop !== 0 && NOT_SCROLLABLE.has(style.overflowY)) element.scrollTop = 0
}

function ancestors(from: Element | null): Element[] {
  const chain: Element[] = []
  for (let element = from; element; element = element.parentElement) chain.push(element)
  return chain
}

/** La ventana, #root, el contenedor de la app y los contenedores dados. */
export function settleScroll(win: Window = window, chain: Element[] = []): void {
  if (win.scrollX !== 0 || win.scrollY !== 0) win.scrollTo(0, 0)
  for (const element of chain) if (element.isConnected) settle(element)
  // #root y el contenedor de la app: lo que el navegador restaura al recargar.
  const root = win.document.getElementById('root')
  if (root) {
    settle(root)
    if (root.firstElementChild) settle(root.firstElementChild)
  }
}

/** Instala la guarda una vez, al arrancar. Devuelve cómo quitarla (tests). */
export function guardDocumentScroll(win: Window = window): () => void {
  const doc = win.document
  if ('scrollRestoration' in win.history) win.history.scrollRestoration = 'manual'

  // El scroll de un elemento no burbujea: se escucha en captura.
  const onScroll = (event: Event) => {
    if (isEditing(doc)) return
    const target = event.target
    if (target instanceof Element) settle(target)
    else settleScroll(win)
  }
  // Al salir del campo el foco todavía no se movió al siguiente: se espera un
  // turno para no acomodar en medio de un salto de un campo a otro. La cadena
  // se toma ahora: si el campo vivía en un panel que se cierra, después ya no
  // se puede subir desde él hasta los contenedores que quedaron corridos.
  const onFocusOut = (event: FocusEvent) => {
    const chain = ancestors(event.target instanceof Element ? event.target : null)
    win.setTimeout(() => {
      if (!isEditing(doc)) settleScroll(win, chain)
    }, 0)
  }

  win.addEventListener('scroll', onScroll, { capture: true, passive: true })
  doc.addEventListener('focusout', onFocusOut)
  if (!isEditing(doc)) settleScroll(win)

  return () => {
    win.removeEventListener('scroll', onScroll, { capture: true })
    doc.removeEventListener('focusout', onFocusOut)
  }
}
