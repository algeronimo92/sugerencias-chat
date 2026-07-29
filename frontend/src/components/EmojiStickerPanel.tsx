import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Loader2, Plus, Search, Smile, Sticker } from 'lucide-react'
import type { EmojiClickData, EmojiStyle, Theme } from 'emoji-picker-react'
import type { MediaAsset } from '../types'
import { useMe } from '../hooks/useAuth'
import { useMediaLibrary, useUploadMediaAsset } from '../hooks/useMediaLibrary'
import { resolveMediaUrl } from '../utils/message'

// El picker es pesado: se carga al vuelo recién al abrir el panel.
const EmojiPicker = lazy(() => import('emoji-picker-react'))

const PANEL_WIDTH = 340

type Tab = 'emoji' | 'sticker'

/** Botón de emojis/stickers del compositor (el 😊 de WhatsApp): abre un panel con
 * dos pestañas. Emojis inserta en el cursor del textarea (lo hace el padre,
 * dueño del cursor); Stickers manda un asset de la librería. El panel queda
 * abierto para encadenar, como WhatsApp. */
export function EmojiStickerPanel({
  onInsertEmoji,
  onSelectSticker,
  disabled,
}: {
  onInsertEmoji: (emoji: string) => void
  onSelectSticker: (asset: MediaAsset) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('emoji')
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
        aria-label="Emojis y stickers"
        aria-haspopup="dialog"
        aria-expanded={open}
        title="Emojis y stickers"
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
          aria-label="Emojis y stickers"
          className="absolute bottom-full left-0 z-30 mb-2 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-wa-border bg-white shadow-xl animate-[ui-popover-in_140ms_ease-out] dark:border-wa-border-dark dark:bg-wa-head-dark"
        >
          <div className="border-b border-wa-border p-1.5 dark:border-wa-border-dark" role="tablist" aria-label="Emojis o stickers">
            <div className="flex rounded-lg bg-wa-field p-0.5 dark:bg-wa-panel-dark">
              {(['emoji', 'sticker'] as const).map((id) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={tab === id}
                  onClick={() => setTab(id)}
                  className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    tab === id
                      ? 'bg-white text-wa-text shadow-sm dark:bg-wa-field-dark dark:text-wa-text-dark'
                      : 'text-wa-muted dark:text-wa-muted-dark'
                  }`}
                >
                  {id === 'emoji' ? 'Emojis' : 'Stickers'}
                </button>
              ))}
            </div>
          </div>

          {tab === 'emoji' ? (
            <div className="wa-emoji">
              <Suspense fallback={<div className="h-[360px] w-[340px] max-w-full" />}>
                <EmojiPicker
                  onEmojiClick={(data: EmojiClickData) => onInsertEmoji(data.emoji)}
                  emojiStyle={'native' as EmojiStyle}
                  theme={(isDark ? 'dark' : 'light') as Theme}
                  lazyLoadEmojis
                  width={PANEL_WIDTH}
                  height={360}
                  previewConfig={{ showPreview: false }}
                  searchPlaceHolder="Buscar emoji"
                />
              </Suspense>
            </div>
          ) : (
            <StickerGrid onSelect={onSelectSticker} />
          )}
        </div>
      )}
    </div>
  )
}

/** Grilla de stickers desde la librería de medios (imágenes). Al enviarlas el
 * backend las convierte a WEBP 512×512. Los admins pueden subir uno nuevo desde
 * acá (la librería es admin-only). Se monta solo cuando la pestaña está activa,
 * así la consulta no corre hasta que hace falta. */
function StickerGrid({ onSelect }: { onSelect: (asset: MediaAsset) => void }) {
  const [search, setSearch] = useState('')
  const { data: assets = [], isLoading } = useMediaLibrary(search, 'image')
  const { data: me } = useMe()
  const isAdmin = me?.role === 'admin'
  const upload = useUploadMediaAsset()
  const fileRef = useRef<HTMLInputElement>(null)

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onloadend = () => {
      const base64 = (reader.result as string).split(',')[1] ?? ''
      upload.mutate({ contentType: file.type, dataBase64: base64, filename: file.name })
    }
    reader.readAsDataURL(file)
  }

  return (
    <div className="flex flex-col" style={{ width: PANEL_WIDTH, maxWidth: '100%' }}>
      <input ref={fileRef} type="file" accept="image/*" onChange={onFileChange} className="hidden" />
      <div className="p-2">
        <div className="flex items-center gap-2 rounded-lg bg-wa-field px-2 dark:bg-wa-field-dark">
          <Search className="h-4 w-4 shrink-0 text-wa-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar"
            className="flex-1 bg-transparent py-1.5 text-sm text-wa-text outline-none placeholder:text-wa-muted dark:text-wa-text-dark"
          />
        </div>
      </div>
      <div className="max-h-72 overflow-auto px-2 pb-2">
        {isLoading ? (
          <div className="grid grid-cols-4 gap-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="aspect-square animate-pulse rounded-lg bg-wa-field dark:bg-wa-field-dark" />
            ))}
          </div>
        ) : assets.length === 0 ? (
          <div className="flex flex-col items-center gap-1.5 px-4 py-10 text-center">
            <Sticker className="h-10 w-10 text-wa-muted" />
            <p className="text-sm font-medium text-wa-text dark:text-wa-text-dark">
              {search ? 'Sin resultados' : 'Todavía no hay stickers'}
            </p>
            {!search && isAdmin && (
              <>
                <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
                  Subí una imagen y quedará lista para mandar como sticker.
                </p>
                <button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={upload.isPending}
                  className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-wa-primary px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-wa-primary-strong disabled:opacity-60"
                >
                  {upload.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                  Subir sticker
                </button>
              </>
            )}
            {!search && !isAdmin && (
              <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
                Pedile a un administrador que cargue los stickers de la clínica.
              </p>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-4 gap-1">
            {isAdmin && (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={upload.isPending}
                aria-label="Subir sticker"
                title="Subir sticker"
                className="flex aspect-square items-center justify-center rounded-lg border border-dashed border-wa-border text-wa-muted transition-colors hover:bg-wa-hover disabled:opacity-60 dark:border-wa-border-dark dark:hover:bg-wa-active-dark"
              >
                {upload.isPending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
              </button>
            )}
            {assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => onSelect(asset)}
                aria-label={asset.filename || 'Sticker'}
                title={asset.filename}
                className="aspect-square rounded-lg p-1.5 transition-transform hover:bg-wa-hover active:scale-95 dark:hover:bg-wa-active-dark"
              >
                <img
                  src={resolveMediaUrl(asset.media_url) ?? undefined}
                  alt={asset.filename}
                  loading="lazy"
                  className="h-full w-full object-contain"
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
