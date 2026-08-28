import { useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical, type LucideIcon } from 'lucide-react'
import { useDismissiblePopover } from '../hooks/useDismissiblePopover'

export interface MessageMenuAction {
  key: string
  icon: LucideIcon
  label: string
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

/** Menú "⋮" con las acciones menos frecuentes de una burbuja (Descargar,
 * Seleccionar, Fijar, Editar, Eliminar): solo Responder/Reaccionar/Reenviar
 * quedan sueltas al pasar el mouse — con todo suelto la barra de acciones
 * termina teniendo hasta 7-8 íconos, igual de recargada que el menú "⋮" que
 * ya usa WhatsApp Web para lo mismo. Mismo patrón de popover posicionado que
 * ReactionMenu (ver MessageReactions.tsx). */
export function MessageActionsMenu({
  actions,
  side,
  triggerClassName = '',
}: {
  actions: MessageMenuAction[]
  /** De qué lado del mensaje está el disparador, para que el popover no se
   * salga por el borde del hilo. */
  side: 'left' | 'right'
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, ready: false })
  const popoverRef = useRef<HTMLDivElement>(null)

  function close() {
    setOpen(false)
    setPosition(current => ({ ...current, ready: false }))
  }

  const triggerRef = useDismissiblePopover<HTMLButtonElement>(open, close, popoverRef)

  useLayoutEffect(() => {
    if (!open) return

    function updatePosition() {
      const anchor = triggerRef.current?.getBoundingClientRect()
      const panel = popoverRef.current?.getBoundingClientRect()
      if (!anchor || !panel) return
      const margin = 8
      const gap = 6
      const preferredLeft = side === 'right' ? anchor.right - panel.width : anchor.left
      const maxLeft = Math.max(margin, window.innerWidth - panel.width - margin)
      const left = Math.min(Math.max(margin, preferredLeft), maxLeft)
      const above = anchor.top - panel.height - gap
      const below = anchor.bottom + gap
      const maxTop = Math.max(margin, window.innerHeight - panel.height - margin)
      const top = above >= margin ? above : Math.min(Math.max(margin, below), maxTop)
      setPosition({ top: Math.round(top), left: Math.round(left), ready: true })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    document.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      document.removeEventListener('scroll', updatePosition, true)
    }
  }, [open, side, triggerRef])

  function run(action: MessageMenuAction) {
    if (action.disabled) return
    close()
    action.onClick()
  }

  if (actions.length === 0) return null

  const popover = open && typeof document !== 'undefined' ? createPortal(
    <div
      ref={popoverRef}
      role="menu"
      className="fixed z-[90] min-w-[11rem] overflow-hidden rounded-lg border border-wa-border bg-white py-1 shadow-lg dark:border-wa-border-dark dark:bg-wa-head-dark"
      style={{ top: position.top, left: position.left, visibility: position.ready ? 'visible' : 'hidden' }}
    >
      {actions.map(action => (
        <button
          key={action.key}
          type="button"
          role="menuitem"
          disabled={action.disabled}
          onClick={() => run(action)}
          className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
            action.danger
              ? 'text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40'
              : 'text-wa-text hover:bg-wa-hover dark:text-wa-text-dark dark:hover:bg-wa-hover-dark'
          }`}
        >
          <action.icon aria-hidden="true" className="h-4 w-4 shrink-0" />
          {action.label}
        </button>
      ))}
    </div>,
    document.body,
  ) : null

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => open ? close() : setOpen(true)}
        aria-label="Más acciones"
        aria-expanded={open}
        aria-haspopup="menu"
        title="Más acciones"
        className={`rounded-full p-1.5 text-wa-muted transition-colors hover:bg-black/5 hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-white/10 dark:hover:text-wa-text-dark ${triggerClassName}`}
      >
        <MoreVertical aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      {popover}
    </div>
  )
}
