import { useRef, useState } from 'react'
import { Crop, FileText, Loader2, Send, X } from 'lucide-react'
import { DialogPrimitive as Dialog } from './ui/Dialog'
import { ImageCropDialog } from './ImageCropDialog'

function fileExtensionLabel(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename)
  return match ? match[1].toUpperCase() : 'ARCHIVO'
}

function formatFileSize(bytes: number): string {
  if (!bytes) return ''
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Pantalla de previsualización antes de enviar un adjunto, como WhatsApp:
 * imagen/video se muestran grandes; un documento se muestra como una tarjeta
 * con su ícono, nombre y tamaño. En los tres casos se deja escribir un
 * epígrafe (caption) y confirmar el envío con Enter o el botón. Para
 * imágenes, un botón abre además la pantalla de recorte (arrastrar/zoom
 * detrás de un marco fijo, con rotación).
 * Se dibuja dentro del panel de conversación (sin Dialog.Portal) para que, en
 * escritorio, la lista de chats y el panel de sugerencias sigan visibles al
 * costado — igual que en WhatsApp Desktop — en vez de tapar toda la ventana. */
export function MediaPreviewDialog({
  previewUrl,
  kind,
  filename,
  fileSize,
  isSending = false,
  onSend,
  onCropped,
  onClose,
}: {
  previewUrl: string
  kind: 'image' | 'video' | 'document'
  filename?: string
  /** Tamaño en bytes del archivo, para el subtítulo de la tarjeta de documento. */
  fileSize?: number
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
        <Dialog.Overlay className="absolute inset-0 z-40 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => { if (isSending) e.preventDefault() }}
          onPointerDownOutside={(e) => { if (isSending) e.preventDefault() }}
          className="absolute inset-0 z-40 flex h-full w-full flex-col overflow-hidden bg-[#0b141a] text-[#e9edef] outline-none"
        >
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-[#111b21] px-3 sm:h-16 sm:px-5">
            <button
              type="button"
              onClick={onClose}
              disabled={isSending}
              aria-label="Cerrar"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#aebac1] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <X className="h-6 w-6" />
            </button>
            <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-medium text-[#e9edef] sm:text-base">
              {filename || 'Vista previa'}
            </Dialog.Title>
            <div className="flex shrink-0 items-center gap-1">
              {kind === 'image' && (
                <button
                  type="button"
                  onClick={() => setIsCropping(true)}
                  disabled={isSending}
                  aria-label="Recortar imagen"
                  title="Recortar"
                  className="flex h-10 w-10 items-center justify-center rounded-full text-[#aebac1] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
                >
                  <Crop className="h-5 w-5" />
                </button>
              )}
            </div>
          </header>

          <main className="flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#0b141a] px-4 py-5 sm:px-10 sm:py-8">
            {kind === 'image' ? (
              <img
                src={previewUrl}
                alt="Vista previa"
                className="max-h-full max-w-full select-none object-contain shadow-2xl"
              />
            ) : kind === 'video' ? (
              <video src={previewUrl} controls className="max-h-full max-w-full bg-black object-contain shadow-2xl" />
            ) : (
              <div className="flex w-full max-w-sm flex-col items-center gap-5 rounded-3xl border border-white/10 bg-[#111b21] px-8 py-10 text-center shadow-2xl">
                <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-2xl bg-[#7c5cff]">
                  <FileText className="h-11 w-11 text-white" />
                </span>
                <div className="min-w-0">
                  <p className="break-words text-base font-medium text-[#e9edef]">{filename || 'Documento'}</p>
                  <p className="mt-1 text-sm text-[#8696a0]">
                    {fileExtensionLabel(filename || '')}
                    {fileSize ? ` · ${formatFileSize(fileSize)}` : ''}
                  </p>
                </div>
              </div>
            )}
          </main>

          <footer className="shrink-0 border-t border-white/10 bg-[#111b21] px-3 pb-safe pt-3 sm:px-6">
            <div className="mx-auto flex w-full max-w-3xl items-end gap-3">
              <textarea
                ref={textareaRef}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                onKeyDown={onKeyDown}
                rows={1}
                autoFocus
                placeholder="Escribe un mensaje"
                className="max-h-24 min-h-12 flex-1 resize-none rounded-xl border border-transparent bg-[#202c33] px-4 py-3 text-sm text-[#e9edef] outline-none transition-shadow placeholder:text-[#8696a0] focus:border-[#00a884]/60 focus:ring-1 focus:ring-[#00a884]/50 sm:text-base"
              />
              <button
                type="button"
                onClick={submit}
                disabled={isSending}
                aria-label="Enviar"
                className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-[#00a884] text-white shadow-lg transition-colors hover:bg-[#06cf9c] disabled:cursor-wait disabled:opacity-60 sm:h-14 sm:w-14"
              >
                {isSending ? <Loader2 className="h-6 w-6 animate-spin" /> : <Send className="h-6 w-6 fill-current" />}
              </button>
            </div>

            <div className="mx-auto flex h-20 w-full max-w-3xl items-center justify-center sm:h-24">
              <div className="flex h-14 w-14 items-center justify-center overflow-hidden rounded-md border-2 border-[#00a884] bg-black sm:h-16 sm:w-16">
                {kind === 'image' ? (
                  <img src={previewUrl} alt="Adjunto seleccionado" className="h-full w-full object-cover" />
                ) : kind === 'video' ? (
                  <video src={previewUrl} muted aria-label="Video seleccionado" className="h-full w-full object-cover" />
                ) : (
                  <span className="flex h-full w-full items-center justify-center bg-[#7c5cff]" aria-label="Documento seleccionado">
                    <FileText className="h-6 w-6 text-white" />
                  </span>
                )}
              </div>
            </div>
          </footer>
        </Dialog.Content>
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
