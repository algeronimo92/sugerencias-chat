import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, SmilePlus } from 'lucide-react'
import type { EmojiClickData, EmojiStyle, Theme } from 'emoji-picker-react'
import type { MessageReaction } from '../types'
import { useDismissiblePopover } from '../hooks/useDismissiblePopover'

// Las seis reacciones rápidas de WhatsApp.
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

// El picker completo es pesado: se carga al vuelo recién cuando se toca "+".
const EmojiPicker = lazy(() => import('emoji-picker-react'))

/** Badge de reacciones colgado en la esquina inferior de la burbuja, como en
 * WhatsApp: los emojis (a lo sumo uno por lado), agrupando repetidos con su
 * conteo. */
export function ReactionBadge({
  reactions,
  isVendedor,
}: {
  reactions: MessageReaction[]
  isVendedor: boolean
}) {
  if (reactions.length === 0) return null
  const grouped = reactions.reduce<{ emoji: string; count: number }[]>((acc, r) => {
    const found = acc.find(g => g.emoji === r.emoji)
    if (found) found.count += 1
    else acc.push({ emoji: r.emoji, count: 1 })
    return acc
  }, [])
  return (
    <div
      className={`absolute -bottom-2.5 z-10 flex items-center gap-0.5 rounded-full border border-wa-border bg-white px-1.5 py-0.5 text-xs leading-none shadow-sm dark:border-wa-border-dark dark:bg-wa-head-dark ${
        isVendedor ? 'right-2' : 'left-2'
      }`}
    >
      {grouped.map(g => (
        <span key={g.emoji} className="flex items-center gap-0.5">
          <span>{g.emoji}</span>
          {g.count > 1 && <span className="text-[10px] text-wa-muted dark:text-wa-text-dark/70">{g.count}</span>}
        </span>
      ))}
    </div>
  )
}

/** Disparador de reacción (aparece al pasar el mouse por la burbuja) y su
 * popover: la barra de reacciones rápidas más un "+" que abre el picker
 * completo. Tocar la reacción propia otra vez la quita, como en WhatsApp. */
export function ReactionMenu({
  ownEmoji,
  onReact,
  side,
  triggerClassName = '',
}: {
  ownEmoji: string | null
  onReact: (emoji: string) => void
  /** De qué lado del mensaje está el disparador, para que el popover no se
   * salga por el borde del hilo. */
  side: 'left' | 'right'
  triggerClassName?: string
}) {
  const [open, setOpen] = useState(false)
  const [showAll, setShowAll] = useState(false)
  const [position, setPosition] = useState({ top: 0, left: 0, ready: false })
  const popoverRef = useRef<HTMLDivElement>(null)

  function close() {
    setOpen(false)
    setShowAll(false)
    setPosition(current => ({ ...current, ready: false }))
  }

  const triggerRef = useDismissiblePopover<HTMLDivElement>(open, close, popoverRef)

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
  }, [open, showAll, side, triggerRef])

  function pick(emoji: string) {
    onReact(ownEmoji === emoji ? '' : emoji)
    close()
  }

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')
  const popover = open && typeof document !== 'undefined' ? createPortal(
    <div
      ref={popoverRef}
      className="fixed z-[90]"
      style={{ top: position.top, left: position.left, visibility: position.ready ? 'visible' : 'hidden' }}
    >
      <div className="flex items-center gap-0.5 rounded-full border border-wa-border bg-white p-1 shadow-lg dark:border-wa-border-dark dark:bg-wa-head-dark">
        {QUICK_REACTIONS.map(emoji => (
          <button
            key={emoji}
            type="button"
            onClick={() => pick(emoji)}
            aria-label={`Reaccionar con ${emoji}`}
            className={`rounded-full p-1 text-lg leading-none transition-transform hover:scale-125 ${
              ownEmoji === emoji ? 'bg-wa-primary/15' : ''
            }`}
          >
            {emoji}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowAll(s => !s)}
          aria-label="Más emojis"
          title="Más emojis"
          className="ml-0.5 rounded-full p-1.5 text-wa-muted hover:bg-black/5 hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-white/10"
        >
          <Plus aria-hidden="true" className="h-4 w-4" />
        </button>
      </div>
      {showAll && (
        <div className="mt-1 overflow-hidden rounded-lg shadow-lg">
          <Suspense fallback={null}>
            <EmojiPicker
              onEmojiClick={(data: EmojiClickData) => pick(data.emoji)}
              emojiStyle={'native' as EmojiStyle}
              theme={(isDark ? 'dark' : 'light') as Theme}
              lazyLoadEmojis
              width={300}
              height={360}
              previewConfig={{ showPreview: false }}
              searchPlaceHolder="Buscar emoji"
            />
          </Suspense>
        </div>
      )}
    </div>,
    document.body,
  ) : null

  return (
    <div ref={triggerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => open ? close() : setOpen(true)}
        aria-label="Reaccionar a este mensaje"
        aria-expanded={open}
        aria-haspopup="dialog"
        title="Reaccionar"
        className={`rounded-full p-1.5 text-wa-muted transition-opacity hover:bg-black/5 hover:text-wa-text focus-visible:opacity-100 dark:text-wa-muted-dark dark:hover:bg-white/10 dark:hover:text-wa-text-dark ${triggerClassName}`}
      >
        <SmilePlus aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      {popover}
    </div>
  )
}
