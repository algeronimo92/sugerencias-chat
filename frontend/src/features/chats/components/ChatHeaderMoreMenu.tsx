import { MessageCircle, MessageCircleOff, MoreVertical, Zap, ZapOff } from 'lucide-react'
import { DropdownMenu, DropdownMenuItem } from '../../../shared/ui/DropdownMenu'

interface Props {
  conversationOpen: boolean
  automationPaused: boolean
  disabled: boolean
  onToggleConversation: () => void
  onToggleAutomation: () => void
}

/**
 * Lo que se usa poco en la cabecera del chat: abrir o cerrar la conversación
 * y apagar las automatizaciones nuevas, con texto (doc 18 §6.3). Antes, en
 * escritorio, eran dos iconos sueltos que solo decían su estado por el color;
 * en el celular ya vivían acá porque no entraban. Como esos estados importan,
 * el botón lleva un punto cuando alguno está fuera de lo normal.
 */
export function ChatHeaderMoreMenu({ conversationOpen, automationPaused, disabled, onToggleConversation, onToggleAutomation }: Props) {
  const attention = !conversationOpen || automationPaused
  return (
    <DropdownMenu
      align="end"
      trigger={
        <button
          type="button"
          disabled={disabled}
          aria-label={attention ? 'Más acciones del chat (hay algo para revisar)' : 'Más acciones del chat'}
          className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-fg-muted outline-none transition-colors hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 data-[state=open]:bg-selected"
        >
          <MoreVertical className="h-5 w-5" aria-hidden="true" />
          {attention && <span className="absolute right-1.5 top-2 h-2 w-2 rounded-full bg-warning ring-2 ring-surface" aria-hidden="true" />}
        </button>
      }
    >
      <DropdownMenuItem onSelect={onToggleConversation}>
        {conversationOpen
          ? <MessageCircle className="h-5 w-5 shrink-0 text-accent-strong" aria-hidden="true" />
          : <MessageCircleOff className="h-5 w-5 shrink-0 text-danger-fg" aria-hidden="true" />}
        <span className="py-1.5">
          <span className="block font-medium">{conversationOpen ? 'Cerrar conversación' : 'Abrir conversación'}</span>
          <span className="block text-xs text-fg-muted">{conversationOpen ? 'Ahora está abierta' : 'Ahora está cerrada'}</span>
        </span>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={onToggleAutomation}>
        {automationPaused
          ? <ZapOff className="h-5 w-5 shrink-0 text-warning-fg" aria-hidden="true" />
          : <Zap className="h-5 w-5 shrink-0 text-fg-muted" aria-hidden="true" />}
        <span className="py-1.5">
          <span className="block font-medium">{automationPaused ? 'Reactivar automatizaciones nuevas' : 'No iniciar automatizaciones nuevas'}</span>
          <span className="block text-xs text-fg-muted">{automationPaused ? 'Ahora están pausadas para este cliente' : 'Ahora están activas para este cliente'}</span>
        </span>
      </DropdownMenuItem>
    </DropdownMenu>
  )
}
