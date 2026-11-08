import { useEffect, useRef } from 'react'
import type { AutomationFlowNodeType } from '../../types'
import { FLOW_PALETTE } from './flowPalette'

const MENU_WIDTH = 256
const MENU_HEIGHT = 360

/**
 * Qué bloque agregar al soltar una conexión en un espacio vacío del lienzo.
 * Antes soltarla ahí no hacía nada: había que arrastrar un bloque desde la
 * barra lateral y después volver a tirar la conexión hasta él. Es lo que hacen
 * los editores de flujos (n8n, Make): soltar en el vacío ofrece qué poner.
 */
export function NodeTypeMenu({ x, y, onPick, onClose }: {
  /** Dónde se soltó, en coordenadas de la ventana. */
  x: number
  y: number
  onPick: (type: AutomationFlowNodeType) => void
  onClose: () => void
}) {
  const menu = useRef<HTMLDivElement>(null)

  useEffect(() => {
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus()
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    const onPointer = (event: PointerEvent) => { if (!menu.current?.contains(event.target as Node)) onClose() }
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointer, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointer, true)
    }
  }, [onClose])

  function onArrow(event: React.KeyboardEvent) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    const current = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length
    items[next]?.focus()
  }

  // Que no se salga de la ventana si se soltó cerca de un borde.
  const left = Math.max(8, Math.min(x, window.innerWidth - MENU_WIDTH - 8))
  const top = Math.max(8, Math.min(y, window.innerHeight - MENU_HEIGHT - 8))

  return (
    <div
      ref={menu}
      role="menu"
      aria-label="Agregar un bloque conectado"
      onKeyDown={onArrow}
      style={{ left, top, width: MENU_WIDTH }}
      className="fixed z-[70] rounded-xl border border-wa-border bg-white p-1.5 shadow-2xl dark:border-flow-border-dark dark:bg-flow-panel-dark"
    >
      <p className="px-2 pb-1.5 pt-1 text-[10px] font-bold uppercase tracking-wider text-wa-muted dark:text-wa-muted-dark">Agregar bloque conectado</p>
      {FLOW_PALETTE.map(({ type, label, icon: Icon, description }) => (
        <button
          key={type}
          type="button"
          role="menuitem"
          onClick={() => onPick(type)}
          className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-wa-hover focus:bg-wa-hover focus:outline-none dark:hover:bg-white/5 dark:focus:bg-white/5"
        >
          <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gray-600 dark:text-gray-300" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-wa-text dark:text-white">{label}</span>
            <span className="block text-[10px] text-wa-muted dark:text-wa-muted-dark">{description}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
