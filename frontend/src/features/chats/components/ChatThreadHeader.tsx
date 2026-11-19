import { ArrowLeft, PanelRight } from 'lucide-react'
import { Avatar } from '../../../shared/ui/Avatar'
import { Tooltip } from '../../../shared/ui/Tooltip'
import { LeadAppointmentAction } from '../../appointments/public/LeadAppointmentAction'
import { CallButton } from '../../calls/public/CallCard'
import { displayName } from '../../leads/public/chat'
import type { Chat } from '../../leads/types'
import type { CustomerServiceWindow } from '../types'
import { ChatHeaderMoreMenu } from './ChatHeaderMoreMenu'
import { CustomerServiceWindowBadge } from './CustomerServiceWindowStatus'
import { LeadQuickFields } from './LeadQuickFields'

const iconButtonClass =
  'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-fg-muted outline-none transition-colors hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring'

interface Props {
  chat: Chat
  isAdmin: boolean
  customerWindow?: CustomerServiceWindow
  isLoadingCustomerWindow: boolean
  isUpdatingLead: boolean
  onToggleConversation: () => void
  onToggleAutomation: () => void
  /** Solo en el celular, donde la lista y la conversación no conviven. */
  onBack?: () => void
  /** Fuera de escritorio la ficha no tiene columna: se abre desde acá. */
  onOpenSuggestions?: () => void
}

/**
 * Cabecera de la conversación (doc 18 §6.3): quién es, en qué etapa está y
 * quién lo atiende, con la ventana de 24 h al lado. Las acciones de venta
 * (llamar, iniciar flujo, separar cita) quedan a la vista; abrir o cerrar la
 * conversación y las automatizaciones nuevas van en "Más", con texto.
 */
export function ChatThreadHeader({
  chat, isAdmin, customerWindow, isLoadingCustomerWindow, isUpdatingLead, onToggleConversation, onToggleAutomation, onBack, onOpenSuggestions,
}: Props) {
  return (
    <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-line bg-surface px-2 sm:px-4">
      <div className="flex min-w-0 items-center gap-2 sm:gap-3">
        {onBack && (
          <button type="button" onClick={onBack} aria-label="Volver a la lista de chats" className={`-ml-1 ${iconButtonClass} w-9`}>
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </button>
        )}
        <Avatar name={displayName(chat)} seed={chat.chat_id} size="sm" className="max-sm:hidden" />
        {/* overflow-hidden: el aviso de las 24 h no puede dibujarse encima de
            los botones cuando el nombre queda angosto en el celular. */}
        <div className="min-w-0 overflow-hidden">
          <p className="truncate text-base font-semibold leading-tight text-fg">{displayName(chat)}</p>
          <div className="mt-0.5 flex min-w-0 items-center gap-1 -ml-1">
            <LeadQuickFields chat={chat} isAdmin={isAdmin} />
            <span className="text-xs text-fg-muted" aria-hidden="true">·</span>
            {/* Solo el tiempo: entra también en el celular. */}
            <span className="min-w-0 shrink">
              <CustomerServiceWindowBadge data={customerWindow} isLoading={isLoadingCustomerWindow} />
            </span>
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        <CallButton chatId={chat.chat_id} name={displayName(chat)} />
        {/* Separar la cita es la venta: se llega en un toque, sin la ficha. */}
        <LeadAppointmentAction chat={chat} />
        <ChatHeaderMoreMenu
          conversationOpen={chat.conversacion_abierta}
          automationPaused={chat.automatizacion_pausada}
          disabled={isUpdatingLead}
          onToggleConversation={onToggleConversation}
          onToggleAutomation={onToggleAutomation}
        />
        {onOpenSuggestions && (
          // Abre la ficha del lead, que además trae el copiloto.
          <Tooltip content="Ficha del lead">
            <button type="button" onClick={onOpenSuggestions} aria-label="Abrir ficha del lead" className={iconButtonClass}>
              <PanelRight className="h-5 w-5" aria-hidden="true" />
            </button>
          </Tooltip>
        )}
      </div>
    </div>
  )
}
