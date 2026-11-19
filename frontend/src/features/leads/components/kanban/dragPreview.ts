import type { DragEvent } from 'react'

/**
 * Imagen que acompaña al cursor al arrastrar un lead: una pastilla con su
 * nombre. Sin esto Chrome toma una captura de la fila y, dentro de la lista
 * con scroll, la recorta corrida y se lleva las filas vecinas: parecía que se
 * movían varios leads cuando se movía uno.
 */
export function setLeadDragPreview(event: DragEvent<HTMLElement>, name: string, initial: string) {
  const ghost = document.createElement('div')
  ghost.setAttribute('aria-hidden', 'true')
  ghost.className =
    'fixed -top-[1000px] left-0 flex max-w-64 items-center gap-2 rounded-full border border-wa-border bg-wa-panel py-1 pl-1 pr-3 text-sm font-semibold text-wa-text shadow-lg dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark'
  const avatar = document.createElement('span')
  avatar.className = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-wa-primary-strong text-xs text-white'
  avatar.textContent = initial
  const label = document.createElement('span')
  label.className = 'truncate'
  label.textContent = name
  ghost.append(avatar, label)
  document.body.append(ghost)
  event.dataTransfer.setDragImage(ghost, 16, 16)
  // El navegador copia la imagen al empezar el arrastre: ya se puede quitar.
  requestAnimationFrame(() => ghost.remove())
}
