import { useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { Check, Loader2, RotateCcw, X } from 'lucide-react'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './ui/Dialog'
import { getCroppedImageFile } from '../utils/cropImage'

const ASPECT_OPTIONS = [
  { key: 'free', label: 'Libre', value: undefined },
  { key: 'square', label: '1:1', value: 1 },
  { key: 'portrait', label: '4:5', value: 4 / 5 },
  { key: 'classic', label: '4:3', value: 4 / 3 },
  { key: 'wide', label: '16:9', value: 16 / 9 },
] as const

/** Pantalla de recorte de fotos como la de WhatsApp: la imagen se arrastra y
 * hace zoom detrás de un marco fijo, con relaciones de aspecto y rotación en
 * pasos de 90°. Se abre desde MediaPreviewDialog antes de confirmar el envío. */
export function ImageCropDialog({
  imageUrl,
  filename,
  onCancel,
  onConfirm,
}: {
  imageUrl: string
  filename: string
  onCancel: () => void
  onConfirm: (file: File) => void
}) {
  const [crop, setCrop] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [aspect, setAspect] = useState<number | undefined>(undefined)
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  async function handleConfirm() {
    if (!croppedAreaPixels || isProcessing) return
    setIsProcessing(true)
    try {
      const file = await getCroppedImageFile(imageUrl, croppedAreaPixels, rotation, filename)
      onConfirm(file)
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !isProcessing) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => { if (isProcessing) e.preventDefault() }}
          onPointerDownOutside={(e) => { if (isProcessing) e.preventDefault() }}
          className={`${dialogContentPositionClass} flex h-[85vh] w-[calc(100%-2rem)] max-w-xl flex-col overflow-hidden rounded-xl border border-wa-border bg-wa-chat shadow-xl dark:border-wa-border-dark dark:bg-wa-chat-dark`}
        >
          <div className="flex items-center justify-between px-3 py-2">
            <Dialog.Title className="text-sm font-medium text-wa-text dark:text-wa-text-dark">Recortar foto</Dialog.Title>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                disabled={isProcessing}
                aria-label="Rotar 90°"
                title="Rotar 90°"
                className="shrink-0 rounded-full p-1.5 text-wa-muted transition-colors hover:bg-black/5 hover:text-wa-text disabled:opacity-50 dark:text-wa-muted-dark dark:hover:bg-white/10"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onCancel}
                disabled={isProcessing}
                aria-label="Cancelar recorte"
                className="shrink-0 rounded-full p-1.5 text-wa-muted transition-colors hover:bg-black/5 hover:text-wa-text disabled:opacity-50 dark:text-wa-muted-dark dark:hover:bg-white/10"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="relative flex-1 bg-black">
            <Cropper
              image={imageUrl}
              crop={crop}
              zoom={zoom}
              rotation={rotation}
              aspect={aspect}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onRotationChange={setRotation}
              onCropComplete={(_area, areaPixels) => setCroppedAreaPixels(areaPixels)}
            />
          </div>

          <div className="flex flex-col gap-3 p-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-wa-muted dark:text-wa-muted-dark">Zoom</span>
              <input
                type="range"
                aria-label="Zoom"
                min={1}
                max={3}
                step={0.01}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-wa-border accent-wa-primary dark:bg-wa-border-dark"
              />
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex flex-wrap gap-1.5">
                {ASPECT_OPTIONS.map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setAspect(option.value)}
                    disabled={isProcessing}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
                      aspect === option.value
                        ? 'bg-wa-primary text-white'
                        : 'bg-wa-field text-wa-text hover:bg-wa-border dark:bg-wa-head-dark dark:text-wa-text-dark dark:hover:bg-wa-active-dark'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={isProcessing || !croppedAreaPixels}
                aria-label="Confirmar recorte"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-wa-primary text-white transition-colors hover:bg-wa-primary-strong disabled:opacity-60"
              >
                {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
