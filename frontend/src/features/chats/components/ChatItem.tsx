import { Avatar } from '../../../shared/ui/Avatar'
import { useState, type MouseEvent as ReactMouseEvent } from 'react'
import { Tooltip } from '../../../shared/ui/Tooltip'
import type { Chat } from '../../leads/types'
import { displayName } from '../../leads/public/chat'
import { useLongPress } from '../hooks/useLongPress'
import { contactMatchReason } from '../searchMatch'
import { ChatItemMenu, type MenuPosition } from './ChatItemMenu'
import { ChatItemMeta } from './ChatItemMeta'
import { ChatItemBadges, ChatItemPreview, ChatItemTime } from './ChatItemParts'
import { Highlighted } from './MessageSearchRow'

interface Props {
  chat: Chat
  isSelected: boolean
  isHighlighted: boolean
  /** Término de búsqueda activo: centra el preview en la coincidencia y la
   * resalta cuando el chat matcheó por un mensaje del historial. */
  search?: string
  /** En la sección "Contactos" del buscador: resalta lo buscado en el nombre
   * y, si el nombre no lo explica, dice por qué campo matcheó el lead. */
  showMatchReason?: boolean
  onClick: () => void
  onPreview: () => void
  onMarkUnread: () => void
  isMarkingUnread?: boolean
  /** Sin el aviso de vista rápida (en modo selección tocar la fila la marca). */
  hideHint?: boolean
}

function rowStateClass(isSelected: boolean, isHighlighted: boolean): string {
  if (isSelected) return 'bg-selected'
  if (isHighlighted) return 'bg-warning-soft ring-1 ring-inset ring-warning'
  return 'hover:bg-subtle'
}

export function ChatItem({ chat, isSelected, isHighlighted, search = '', showMatchReason = false, onClick, onPreview, onMarkUnread, isMarkingUnread = false, hideHint = false }: Props) {
  const [contextMenu, setContextMenu] = useState<MenuPosition | null>(null)
  const longPress = useLongPress(onPreview)
  const matchReason = showMatchReason ? contactMatchReason(chat, search) : null

  function openContextMenu(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    longPress.cancel()
    // Posición cruda del clic: el menú la corrige contra su tamaño real
    // apenas se monta, antes de pintar.
    setContextMenu({ x: event.clientX, y: event.clientY })
  }

  return (
    <>
    <Tooltip content={hideHint ? null : "Mantén pulsado o usa clic derecho para vista rápida"} side="bottom">
    <button type="button"
      onClick={(event) => {
        if (longPress.consumeSuppressedClick(event)) return
        onClick()
      }}
      onContextMenu={openContextMenu}
      {...longPress.handlers}
      onKeyDown={(event) => {
        if (event.shiftKey && event.key === 'Enter') {
          event.preventDefault()
          onPreview()
        }
      }}
      className={`mx-2 my-0.5 flex w-[calc(100%-1rem)] items-start gap-3 rounded-lg px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${rowStateClass(isSelected, isHighlighted)}`}
    >
      {/* Tono estable por lead (no por nombre): no cambia al renombrarlo. */}
      <Avatar name={displayName(chat)} seed={chat.chat_id} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-md text-fg ${chat.unread_count > 0 ? 'font-semibold' : 'font-medium'}`}>
            {showMatchReason ? <Highlighted text={displayName(chat)} search={search} /> : displayName(chat)}
          </span>
          <ChatItemTime chat={chat} />
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2">
          <ChatItemPreview chat={chat} search={search} isSelected={isSelected} />
          <ChatItemBadges chat={chat} />
        </div>
        {matchReason && (
          <p className="mt-0.5 truncate text-xs text-fg-muted">
            {matchReason.label}: <Highlighted text={matchReason.value} search={search} />
          </p>
        )}
        <ChatItemMeta chat={chat} />
      </div>
    </button>
    </Tooltip>
    <ChatItemMenu
      chat={chat}
      position={contextMenu}
      onPositionChange={setContextMenu}
      onPreview={onPreview}
      onMarkUnread={onMarkUnread}
      isMarkingUnread={isMarkingUnread}
    />
    </>
  )
}
