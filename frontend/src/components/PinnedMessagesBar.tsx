import { ChevronLeft, ChevronRight, Pin, X } from 'lucide-react'
import type { Message } from '../types'
import { quotePreview } from '../utils/message'

/** Barra de mensajes fijados arriba del hilo, como en WhatsApp nativo — salvo
 * que esto es puramente del CRM: no hay forma de mandar un fijado hacia
 * WhatsApp (ni Evolution API ni Baileys lo exponen), así que el cliente nunca
 * ve esta barra ni sabe que existe. Hasta 3 por chat; con más de uno, un mini
 * carrusel deja navegarlos con las flechas. */
export function PinnedMessagesBar({
  pinned,
  activeIndex,
  onSelectIndex,
  onJump,
  onUnpin,
}: {
  pinned: Message[]
  activeIndex: number
  onSelectIndex: (index: number) => void
  onJump: (messageId: number) => void
  onUnpin: (messageId: number) => void
}) {
  if (pinned.length === 0) return null
  const index = Math.min(activeIndex, pinned.length - 1)
  const message = pinned[index]
  const { icon: Icon, label, text } = quotePreview({ content: message.content, message_type: message.message_type })

  return (
    <div className="flex items-center gap-2 border-b border-wa-border bg-white px-3 py-2 dark:border-wa-border-dark dark:bg-wa-head-dark">
      <Pin aria-hidden="true" className="h-4 w-4 shrink-0 text-wa-primary-strong dark:text-wa-primary" />
      <button
        type="button"
        onClick={() => onJump(message.id)}
        title="Ir al mensaje fijado"
        className="flex min-w-0 flex-1 flex-col items-start gap-0.5 overflow-hidden rounded px-1 py-0.5 text-left hover:bg-wa-hover dark:hover:bg-wa-hover-dark"
      >
        {pinned.length > 1 && (
          <span className="text-[11px] font-semibold leading-tight text-wa-primary-strong dark:text-wa-primary">
            {index + 1} de {pinned.length} fijados
          </span>
        )}
        <span className="flex w-full min-w-0 items-center gap-1 text-xs leading-tight text-wa-muted dark:text-wa-text-dark/70">
          {Icon && <Icon aria-hidden="true" className="h-3 w-3 shrink-0" />}
          {label && !text && <span>{label}</span>}
          {text && <span className="truncate">{text}</span>}
        </span>
      </button>
      {pinned.length > 1 && (
        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            onClick={() => onSelectIndex((index - 1 + pinned.length) % pinned.length)}
            aria-label="Fijado anterior"
            title="Anterior"
            className="rounded-full p-1 text-wa-muted transition-colors hover:bg-black/5 hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-white/10 dark:hover:text-wa-text-dark"
          >
            <ChevronLeft aria-hidden="true" className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onSelectIndex((index + 1) % pinned.length)}
            aria-label="Siguiente fijado"
            title="Siguiente"
            className="rounded-full p-1 text-wa-muted transition-colors hover:bg-black/5 hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-white/10 dark:hover:text-wa-text-dark"
          >
            <ChevronRight aria-hidden="true" className="h-4 w-4" />
          </button>
        </div>
      )}
      <button
        type="button"
        onClick={() => onUnpin(message.id)}
        aria-label="Desfijar este mensaje"
        title="Desfijar"
        className="shrink-0 rounded-full p-1.5 text-wa-muted transition-colors hover:bg-black/5 hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-white/10 dark:hover:text-wa-text-dark"
      >
        <X aria-hidden="true" className="h-4 w-4" />
      </button>
    </div>
  )
}
