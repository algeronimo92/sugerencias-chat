import { MessageCircle, MessageCircleOff, MoreVertical, Zap, ZapOff } from 'lucide-react'
import { useState } from 'react'
import { useDismissiblePopover } from '../../../shared/hooks/useDismissiblePopover'

interface Props {
  conversationOpen: boolean
  automationPaused: boolean
  disabled: boolean
  onToggleConversation: () => void
  onToggleAutomation: () => void
}

const itemClass = 'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-sm text-wa-text transition-colors hover:bg-wa-hover disabled:opacity-50 dark:text-wa-text-dark dark:hover:bg-wa-hover-dark'

/**
 * En el celular la cabecera del chat no da para seis botones: con "Separar
 * cita" el nombre quedaba en tres letras y el aviso de las 24 h se dibujaba
 * encima de los íconos. Abrir/cerrar la conversación y pausar automatizaciones
 * pasan a este menú. Como esos dos botones también mostraban un estado (rojo,
 * ámbar), el menú lleva un punto cuando alguno está fuera de lo normal.
 */
export function ChatHeaderMoreMenu({ conversationOpen, automationPaused, disabled, onToggleConversation, onToggleAutomation }: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useDismissiblePopover<HTMLDivElement>(open, () => setOpen(false))
  const attention = !conversationOpen || automationPaused

  function run(action: () => void) {
    setOpen(false)
    action()
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={attention ? 'Más acciones (hay algo para revisar)' : 'Más acciones'}
        className="relative flex h-11 w-10 shrink-0 items-center justify-center rounded-lg text-wa-muted transition-colors hover:bg-black/5 dark:text-wa-muted-dark dark:hover:bg-white/5"
      >
        <MoreVertical className="h-5 w-5" aria-hidden="true" />
        {attention && <span className="absolute right-1.5 top-2 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-wa-head dark:ring-wa-head-dark" aria-hidden="true" />}
      </button>
      {open && (
        <div role="menu" aria-label="Más acciones del chat" className="absolute right-0 top-12 z-40 w-72 rounded-xl border border-wa-border bg-white p-1.5 shadow-xl dark:border-wa-border-dark dark:bg-wa-head-dark">
          <button type="button" role="menuitem" className={itemClass} disabled={disabled} onClick={() => run(onToggleConversation)}>
            {conversationOpen
              ? <MessageCircle className="h-5 w-5 shrink-0 text-wa-primary-strong dark:text-wa-primary" aria-hidden="true" />
              : <MessageCircleOff className="h-5 w-5 shrink-0 text-red-500 dark:text-red-400" aria-hidden="true" />}
            <span>
              <span className="block font-medium">{conversationOpen ? 'Cerrar conversación' : 'Abrir conversación'}</span>
              <span className="block text-xs text-wa-muted dark:text-wa-muted-dark">{conversationOpen ? 'Ahora está abierta' : 'Ahora está cerrada'}</span>
            </span>
          </button>
          <button type="button" role="menuitem" className={itemClass} disabled={disabled} onClick={() => run(onToggleAutomation)}>
            {automationPaused
              ? <ZapOff className="h-5 w-5 shrink-0 text-amber-700 dark:text-amber-400" aria-hidden="true" />
              : <Zap className="h-5 w-5 shrink-0 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />}
            <span>
              <span className="block font-medium">{automationPaused ? 'Reactivar automatizaciones nuevas' : 'No iniciar automatizaciones nuevas'}</span>
              <span className="block text-xs text-wa-muted dark:text-wa-muted-dark">{automationPaused ? 'Ahora están pausadas para este cliente' : 'Ahora están activas para este cliente'}</span>
            </span>
          </button>
        </div>
      )}
    </div>
  )
}
