import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Plus, SmilePlus } from 'lucide-react'
import type { EmojiClickData, EmojiStyle, Theme } from 'emoji-picker-react'
import type { MessageReaction } from '../types'

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
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false)
        setShowAll(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function pick(emoji: string) {
    onReact(ownEmoji === emoji ? '' : emoji)
    setOpen(false)
    setShowAll(false)
  }

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label="Reaccionar a este mensaje"
        title="Reaccionar"
        className={`rounded-full p-1.5 text-wa-muted transition-opacity hover:bg-black/5 hover:text-wa-text focus-visible:opacity-100 dark:text-wa-muted-dark dark:hover:bg-white/10 dark:hover:text-wa-text-dark ${triggerClassName}`}
      >
        <SmilePlus aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          className={`absolute bottom-full z-30 mb-1 ${side === 'right' ? 'right-0' : 'left-0'}`}
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
        </div>
      )}
    </div>
  )
}
