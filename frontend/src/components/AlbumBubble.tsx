import { Check, CircleCheck, Download, Forward, Video } from 'lucide-react'
import type { Message } from '../types'
import { formatMessageTime, resolveMediaUrl } from '../utils/message'
import { MessageStatusTicks } from './MessageBubble'
import type { OpenMedia } from './MessageBubble'

// Máximo de miniaturas visibles en la grilla; el resto queda atrás del "+N"
// de la última — igual que WhatsApp, que tampoco expande el preview entero.
const MAX_TILES = 4

interface Props {
  /** 2+ fotos/videos consecutivos del mismo remitente (ver groupAlbumMessages
   * en utils/mediaGroups) que se pintan como una sola grilla. */
  messages: Message[]
  isFirstOfGroup: boolean
  failedMediaIds: Set<number>
  onMediaFailed: (messageId: number) => void
  onOpenMedia: (media: OpenMedia) => void
  onRetry: () => void
  onDiscard: () => void
  onForwardAll: () => void
  onDownloadAll: () => void
  selectionMode: boolean
  isSelected: boolean
  onToggleSelect: () => void
}

/** Grilla de 2 a `MAX_TILES` fotos/videos enviados juntos, como el álbum
 * nativo de WhatsApp — que el backend no puede reconstruir desde
 * `albumMessage`/`associatedChildMessage` (ver docs/n8n-normalizacion-wsp-messages.md),
 * así que esto agrupa por heurístico de tiempo (mediaGroups.ts) en vez de un
 * id de álbum real. Tocar cualquier miniatura abre el visor con la galería
 * completa del chat, donde se puede seguir navegando más allá del grupo. */
export function AlbumBubble({
  messages,
  isFirstOfGroup,
  failedMediaIds,
  onMediaFailed,
  onOpenMedia,
  onRetry,
  onDiscard,
  onForwardAll,
  onDownloadAll,
  selectionMode,
  isSelected,
  onToggleSelect,
}: Props) {
  const isVendedor = messages[0].sender === 'vendedor'
  const last = messages[messages.length - 1]
  const visible = messages.slice(0, MAX_TILES)
  const hiddenCount = messages.length - visible.length
  // El pie muestra la hora/estado del último envío del lote, igual que
  // WhatsApp agrupa el tique de todo el álbum en la última foto.
  const caption = messages.find(m => (m.content ?? '').trim())?.content?.trim() ?? null
  const actionButtonClass = 'rounded-full p-1.5 text-wa-muted transition-colors hover:bg-black/5 hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-white/10 dark:hover:text-wa-text-dark'

  function tileFor(message: Message): { src: string | null; isVideo: boolean } {
    const failed = failedMediaIds.has(message.id)
    const src = failed ? null : resolveMediaUrl(message.media_url)
    return { src, isVideo: message.message_type === 'video' || message.message_type === 'ptv' }
  }

  const actions = !selectionMode && (
    <div className="flex shrink-0 items-center opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
      <button type="button" onClick={onForwardAll} aria-label={`Reenviar las ${messages.length} fotos`} title="Reenviar todo" className={actionButtonClass}>
        <Forward aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onDownloadAll} aria-label={`Descargar las ${messages.length} fotos`} title="Descargar todo" className={actionButtonClass}>
        <Download aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={onToggleSelect} aria-label="Seleccionar este álbum" title="Seleccionar" className={actionButtonClass}>
        <CircleCheck aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </div>
  )

  return (
    <div
      className={`group flex items-center gap-1 ${isVendedor ? 'justify-end' : 'justify-start'} ${isFirstOfGroup ? 'mt-3' : 'mt-[3px]'} ${
        selectionMode
          ? `-mx-3 select-none px-3 sm:-mx-6 sm:px-6 cursor-pointer ${isSelected ? 'bg-wa-primary/10 dark:bg-wa-primary/15' : ''}`
          : ''
      }`}
      onClick={selectionMode ? onToggleSelect : undefined}
      role={selectionMode ? 'button' : undefined}
      tabIndex={selectionMode ? 0 : undefined}
      aria-pressed={selectionMode ? isSelected : undefined}
      aria-label={selectionMode ? `Seleccionar álbum de ${messages.length} fotos` : undefined}
    >
      {selectionMode && (
        <span
          aria-hidden="true"
          className={`mr-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors ${isVendedor ? 'mr-auto' : ''} ${
            isSelected ? 'border-wa-primary bg-wa-primary text-white' : 'border-wa-muted/50 dark:border-wa-muted-dark/60'
          }`}
        >
          {isSelected && <Check className="h-3 w-3" />}
        </span>
      )}
      {isVendedor && actions}
      <div className="flex max-w-[85%] flex-col sm:max-w-[75%]">
        <div
          className={`relative w-60 rounded-bubble p-1.5 text-sm shadow-sm text-wa-text dark:text-wa-text-dark ${
            isVendedor
              ? `bg-wa-out dark:bg-wa-out-dark ${isFirstOfGroup ? 'rounded-tr-none bubble-tail-out' : ''}`
              : `bg-white dark:bg-wa-in-dark ${isFirstOfGroup ? 'rounded-tl-none bubble-tail-in' : ''}`
          }`}
        >
          {selectionMode && <span aria-hidden="true" className="absolute inset-0 z-20 rounded-bubble" />}
          <div className="grid grid-cols-2 gap-0.5 overflow-hidden rounded-lg">
            {visible.map((message, index) => {
              const { src, isVideo } = tileFor(message)
              const isLastVisible = index === visible.length - 1
              return (
                <button
                  key={message.id}
                  type="button"
                  disabled={selectionMode}
                  onClick={() => {
                    if (!src) return
                    onOpenMedia({ src, kind: isVideo ? 'video' : 'image', alt: isVideo ? 'Video' : 'Imagen' })
                  }}
                  className="relative aspect-square w-full overflow-hidden bg-black/5 dark:bg-white/5"
                  aria-label={`Ver ${isVideo ? 'video' : 'imagen'} ${index + 1} de ${messages.length}`}
                >
                  {src ? (
                    isVideo
                      ? <video src={src} muted preload="metadata" onError={() => onMediaFailed(message.id)} className="h-full w-full object-cover" />
                      : <img src={src} alt="" onError={() => onMediaFailed(message.id)} className="h-full w-full object-cover" />
                  ) : (
                    <span className="absolute inset-0 flex items-center justify-center text-wa-muted dark:text-wa-text-dark/60">
                      <Download className="h-5 w-5" />
                    </span>
                  )}
                  {isVideo && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/15">
                      <Video aria-hidden="true" className="h-5 w-5 fill-white text-white" />
                    </span>
                  )}
                  {isLastVisible && hiddenCount > 0 && (
                    <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-base font-semibold text-white">
                      +{hiddenCount}
                    </span>
                  )}
                </button>
              )
            })}
          </div>
          {caption && <p className="whitespace-pre-wrap break-words px-1 pt-1.5">{caption}</p>}
          <div className="flex items-center justify-end gap-1 px-1 pt-1 text-[10px] text-wa-faint dark:text-wa-text-dark/60">
            <span>{formatMessageTime(last.sent_at)}</span>
            {isVendedor && <MessageStatusTicks status={last.status} onRetry={onRetry} onDiscard={onDiscard} />}
          </div>
        </div>
      </div>
      {!isVendedor && actions}
    </div>
  )
}
