import { lazy, Suspense, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Plus, SmilePlus, UserRound, X } from 'lucide-react'
import type { EmojiClickData, EmojiStyle, Theme } from 'emoji-picker-react'
import type { MessageReaction } from '../types'
import { useDismissiblePopover } from '../hooks/useDismissiblePopover'
import { DialogPrimitive, dialogContentPositionClass, dialogOverlayClass } from './ui/Dialog'

// Las seis reacciones rápidas de WhatsApp.
const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '😢', '🙏']

// El picker completo es pesado: se carga al vuelo recién cuando se toca "+".
const EmojiPicker = lazy(() => import('emoji-picker-react'))

function reactionCountLabel(count: number) {
  return `${count} ${count === 1 ? 'reacción' : 'reacciones'}`
}

/** Badge de reacciones colgado en la esquina inferior de la burbuja, como en
 * WhatsApp. Al tocarlo abre el detalle de cada reacción y quién la puso. */
export function ReactionBadge({
  reactions,
  isVendedor,
  contactName,
  onReact,
}: {
  reactions: MessageReaction[]
  isVendedor: boolean
  contactName: string
  onReact: (emoji: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [selectedEmoji, setSelectedEmoji] = useState<string | null>(null)
  if (reactions.length === 0) return null

  const grouped = reactions.reduce<{ emoji: string; count: number }[]>((acc, r) => {
    const found = acc.find(g => g.emoji === r.emoji)
    if (found) found.count += 1
    else acc.push({ emoji: r.emoji, count: 1 })
    return acc
  }, [])

  const visibleReactions = selectedEmoji
    ? reactions.filter(reaction => reaction.emoji === selectedEmoji)
    : reactions

  return (
    <DialogPrimitive.Root
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (!nextOpen) setSelectedEmoji(null)
      }}
    >
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={`Ver ${reactionCountLabel(reactions.length)}`}
          className={`absolute -bottom-2.5 z-10 flex items-center gap-1 rounded-full border border-wa-border bg-white px-1.5 py-0.5 text-xs leading-none shadow-sm transition-colors hover:bg-wa-field focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary dark:border-wa-border-dark dark:bg-wa-head-dark dark:hover:bg-wa-field-dark ${
            isVendedor ? 'right-2' : 'left-2'
          }`}
        >
          <span aria-hidden="true">{grouped.map(group => group.emoji).join('')}</span>
          {reactions.length > 1 && (
            <span className="text-[10px] text-wa-muted dark:text-wa-text-dark/70">{reactions.length}</span>
          )}
        </button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className={dialogOverlayClass} />
        <DialogPrimitive.Content
          className={`${dialogContentPositionClass} w-[calc(100vw-2rem)] max-w-md overflow-hidden rounded-2xl border border-wa-border bg-white shadow-2xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}
          aria-describedby={undefined}
        >
          <div className="flex items-center justify-between px-5 pb-2 pt-4">
            <DialogPrimitive.Title className="text-base font-semibold text-wa-text dark:text-wa-text-dark">
              {reactionCountLabel(reactions.length)}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <button
                type="button"
                aria-label="Cerrar reacciones"
                className="rounded-full p-1.5 text-wa-muted hover:bg-wa-field hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-wa-field-dark dark:hover:text-wa-text-dark"
              >
                <X aria-hidden="true" className="h-4 w-4" />
              </button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto border-b border-wa-border px-4 pb-3 dark:border-wa-border-dark">
            <button
              type="button"
              onClick={() => setSelectedEmoji(null)}
              aria-label="Mostrar todas las reacciones"
              aria-pressed={selectedEmoji === null}
              className={`flex h-10 min-w-10 items-center justify-center rounded-full border px-3 text-sm font-medium transition-colors ${
                selectedEmoji === null
                  ? 'border-wa-primary bg-wa-primary/10 text-wa-primary-strong dark:text-wa-primary'
                  : 'border-wa-border text-wa-muted hover:bg-wa-field dark:border-wa-border-dark dark:text-wa-muted-dark dark:hover:bg-wa-field-dark'
              }`}
            >
              {reactions.length}
            </button>
            {grouped.map(group => (
              <button
                key={group.emoji}
                type="button"
                onClick={() => setSelectedEmoji(group.emoji)}
                aria-label={`Mostrar ${group.count} con ${group.emoji}`}
                aria-pressed={selectedEmoji === group.emoji}
                className={`flex h-10 items-center gap-1.5 rounded-full border px-3 text-base transition-colors ${
                  selectedEmoji === group.emoji
                    ? 'border-wa-primary bg-wa-primary/10'
                    : 'border-wa-border hover:bg-wa-field dark:border-wa-border-dark dark:hover:bg-wa-field-dark'
                }`}
              >
                <span aria-hidden="true">{group.emoji}</span>
                <span className="text-xs font-semibold text-wa-muted dark:text-wa-muted-dark">{group.count}</span>
              </button>
            ))}
          </div>

          <div className="max-h-[55vh] overflow-y-auto py-1">
            {visibleReactions.map((reaction, index) => {
              const isOwn = reaction.from_me
              const row = (
                <>
                  <span
                    aria-hidden="true"
                    className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
                      isOwn
                        ? 'bg-[#7c4937] text-[#ffd4bd]'
                        : 'bg-wa-primary/15 font-semibold text-wa-primary-strong dark:text-wa-primary'
                    }`}
                  >
                    {isOwn ? <UserRound className="h-5 w-5" /> : contactName.slice(0, 1).toUpperCase()}
                  </span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-sm font-semibold text-wa-text dark:text-wa-text-dark">
                      {isOwn ? 'Tú' : contactName}
                    </span>
                    {isOwn && (
                      <span className="mt-0.5 block text-xs text-wa-muted dark:text-wa-muted-dark">
                        Haz clic para quitarla
                      </span>
                    )}
                  </span>
                  <span aria-label={`Reaccionó con ${reaction.emoji}`} className="text-2xl">
                    {reaction.emoji}
                  </span>
                </>
              )

              return isOwn ? (
                <button
                  key={`${reaction.emoji}-${index}`}
                  type="button"
                  onClick={() => {
                    onReact('')
                    setOpen(false)
                  }}
                  className="flex w-full items-center gap-3 px-5 py-3 hover:bg-wa-field dark:hover:bg-wa-field-dark"
                >
                  {row}
                </button>
              ) : (
                <div key={`${reaction.emoji}-${index}`} className="flex items-center gap-3 px-5 py-3">
                  {row}
                </div>
              )
            })}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
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
