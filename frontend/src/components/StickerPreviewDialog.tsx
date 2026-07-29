import { useState } from 'react'
import { Check, Loader2, Plus, X } from 'lucide-react'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './ui/Dialog'
import { useMe } from '../hooks/useAuth'
import { useSaveStickerToLibrary } from '../hooks/useMediaLibrary'

/** Previsualización de un sticker del chat (como al tocarlo en WhatsApp): lo
 * muestra grande y deja agregarlo a la librería para reenviarlo. La opción de
 * agregar es solo para admins (la librería es curada por ellos). */
export function StickerPreviewDialog({
  mediaSrc,
  mediaUrl,
  onClose,
}: {
  mediaSrc: string
  mediaUrl: string
  onClose: () => void
}) {
  const { data: me } = useMe()
  const isAdmin = me?.role === 'admin'
  const save = useSaveStickerToLibrary()
  const [saved, setSaved] = useState(false)

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content
          aria-describedby={undefined}
          className={`${dialogContentPositionClass} w-[calc(100%-2rem)] max-w-xs overflow-hidden rounded-2xl border border-wa-border bg-white shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}
        >
          <div className="flex items-center justify-between border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
            <Dialog.Title className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Sticker</Dialog.Title>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="text-wa-muted transition-colors hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-center justify-center bg-wa-chat p-8 dark:bg-wa-chat-dark">
            <img src={mediaSrc} alt="Sticker" className="max-h-56 max-w-full object-contain" />
          </div>

          {isAdmin && (
            <div className="border-t border-wa-border dark:border-wa-border-dark">
              <button
                type="button"
                onClick={() => save.mutate(mediaUrl, { onSuccess: () => setSaved(true) })}
                disabled={save.isPending || saved}
                className="flex w-full items-center justify-center gap-1.5 py-3 text-sm font-medium text-wa-primary transition-colors hover:bg-wa-hover disabled:opacity-70 dark:hover:bg-wa-head-dark"
              >
                {save.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : saved ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {saved ? 'Agregado a tus stickers' : 'Agregar a mis stickers'}
              </button>
              {save.isError && (
                <p className="px-4 pb-2 text-center text-xs text-red-500">No se pudo agregar. Probá de nuevo.</p>
              )}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
