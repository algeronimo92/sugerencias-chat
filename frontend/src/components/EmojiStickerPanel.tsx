import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Smile } from 'lucide-react'
import type { EmojiClickData, EmojiStyle, Theme } from 'emoji-picker-react'

// El picker es pesado: se carga al vuelo recién al abrir el panel.
const EmojiPicker = lazy(() => import('emoji-picker-react'))

/** Botón de emojis del compositor (el 😊 de WhatsApp): abre un panel y al elegir
 * un emoji lo inserta en el textarea (lo hace el padre, dueño del cursor). El
 * panel queda abierto para encadenar varios, como WhatsApp. Preparado para
 * sumarle la pestaña de stickers. */
export function EmojiStickerPanel({
  onInsertEmoji,
  disabled,
}: {
  onInsertEmoji: (emoji: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false)
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [open])

  function toggle() {
    setOpen((prev) => {
      const next = !prev
      // Móvil: al abrir, colapsar el teclado nativo para que el panel ocupe su
      // lugar (el gesto de WhatsApp). El padre conserva la posición del cursor.
      if (next && window.matchMedia('(max-width: 767px)').matches) {
        ;(document.activeElement as HTMLElement | null)?.blur()
      }
      return next
    })
  }

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label="Insertar emoji"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Emojis"
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary/60 disabled:cursor-not-allowed disabled:opacity-50 ${
          open
            ? 'bg-wa-active text-wa-primary dark:bg-wa-active-dark'
            : 'text-wa-muted hover:bg-wa-field dark:text-wa-muted-dark dark:hover:bg-wa-head-dark'
        }`}
      >
        <Smile className="h-5 w-5" />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Emojis"
          className="absolute bottom-full left-0 z-30 mb-2 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-wa-border bg-white shadow-xl animate-[ui-popover-in_140ms_ease-out] dark:border-wa-border-dark dark:bg-wa-head-dark"
        >
          <div className="wa-emoji">
            <Suspense fallback={<div className="h-[360px] w-[340px] max-w-full" />}>
              <EmojiPicker
                onEmojiClick={(data: EmojiClickData) => onInsertEmoji(data.emoji)}
                emojiStyle={'native' as EmojiStyle}
                theme={(isDark ? 'dark' : 'light') as Theme}
                lazyLoadEmojis
                width={340}
                height={360}
                previewConfig={{ showPreview: false }}
                searchPlaceHolder="Buscar emoji"
              />
            </Suspense>
          </div>
        </div>
      )}
    </div>
  )
}
