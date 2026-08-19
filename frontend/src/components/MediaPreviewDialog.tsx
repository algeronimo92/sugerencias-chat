import { useRef, useState } from 'react'
import { Crop, Loader2, Send, X } from 'lucide-react'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './ui/Dialog'
import { ImageCropDialog } from './ImageCropDialog'

/** Pantalla de previsualización antes de enviar una imagen/video, como WhatsApp:
 * muestra el adjunto grande y deja escribir un epígrafe (caption) y confirmar el
 * envío con Enter o el botón. Para imágenes, un botón abre además la pantalla
 * de recorte (arrastrar/zoom detrás de un marco fijo, con rotación). */
export function MediaPreviewDialog({
  previewUrl,
  kind,
  filename,
  isSending = false,
  onSend,
  onCropped,
  onClose,
}: {
  previewUrl: string
  kind: 'image' | 'video'
  filename?: string
  isSending?: boolean
  onSend: (caption: string) => void
  /** Reemplaza el archivo/preview pendientes en el padre por la versión recortada. */
  onCropped: (file: File) => void
  onClose: () => void
}) {
  const [caption, setCaption] = useState('')
  const [isCropping, setIsCropping] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  function submit() {
    if (isSending) return
    onSend(caption.trim())
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  return (
    <>
      <Dialog.Root open onOpenChange={(open) => { if (!open && !isSending) onClose() }}>
        <Dialog.Portal>
          <Dialog.Overlay className={dialogOverlayClass} />
          <Dialog.Content
            aria-describedby={undefined}
            onEscapeKeyDown={(e) => { if (isSending) e.preventDefault() }}
            onPointerDownOutside={(e) => { if (isSending) e.preventDefault() }}
            className={`${dialogContentPositionClass} flex w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden rounded-xl border border-wa-border bg-wa-chat shadow-xl dark:border-wa-border-dark dark:bg-wa-chat-dark`}
          >
            <div className="flex items-center justify-between px-3 py-2">
              <Dialog.Title className="truncate text-sm font-medium text-wa-text dark:text-wa-text-dark">
                {filename || 'Vista previa'}
              </Dialog.Title>
              <div className="flex items-center gap-1">
                {kind === 'image' && (
                  <button
                    type="button"
                    onClick={() => setIsCropping(true)}
                    disabled={isSending}
                    aria-label="Recortar imagen"
                    title="Recortar"
                    className="shrink-0 rounded-full p-1.5 text-wa-muted transition-colors hover:bg-black/5 hover:text-wa-text disabled:opacity-50 dark:text-wa-muted-dark dark:hover:bg-white/10"
                  >
                    <Crop className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={onClose}
                  disabled={isSending}
                  aria-label="Cerrar"
                  className="shrink-0 rounded-full p-1.5 text-wa-muted transition-colors hover:bg-black/5 hover:text-wa-text disabled:opacity-50 dark:text-wa-muted-dark dark:hover:bg-white/10"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex min-h-[12rem] items-center justify-center px-4 py-2">
              {kind === 'image' ? (
                <img src={previewUrl} alt="Vista previa" className="max-h-[55vh] max-w-full rounded-lg object-contain" />
              ) : (
                <video src={previewUrl} controls className="max-h-[55vh] max-w-full rounded-lg" />
              )}
            </div>

            <div className="flex items-end gap-2 p-3">
              <textarea
                ref={textareaRef}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                autoFocus
                placeholder="Escribe algo..."
                className="max-h-24 flex-1 resize-none rounded-lg border border-transparent bg-white px-3.5 py-2 text-sm text-wa-text outline-none transition-shadow placeholder:text-wa-muted focus:ring-2 focus:ring-wa-primary/60 dark:bg-wa-field-dark dark:text-wa-text-dark dark:placeholder:text-wa-muted-dark"
              />
              <button
                type="button"
                onClick={submit}
                disabled={isSending}
                aria-label="Enviar"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-wa-primary text-white transition-colors hover:bg-wa-primary-strong disabled:opacity-60"
              >
                {isSending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
              </button>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {isCropping && (
        <ImageCropDialog
          imageUrl={previewUrl}
          filename={filename || 'imagen.jpg'}
          onCancel={() => setIsCropping(false)}
          onConfirm={(file) => {
            setIsCropping(false)
            onCropped(file)
          }}
        />
      )}
    </>
  )
}
