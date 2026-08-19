import { useState } from 'react'
import Cropper, { type Area } from 'react-easy-crop'
import { Check, Loader2, RotateCcw, X } from 'lucide-react'
import { DialogPrimitive as Dialog, dialogOverlayClass } from './ui/Dialog'
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
        <Dialog.Overlay className={`${dialogOverlayClass} bg-black/85 backdrop-blur-none`} />
        <Dialog.Content
          aria-describedby={undefined}
          onEscapeKeyDown={(e) => { if (isProcessing) e.preventDefault() }}
          onPointerDownOutside={(e) => { if (isProcessing) e.preventDefault() }}
          className="fixed inset-0 z-[52] flex h-[100dvh] w-screen flex-col overflow-hidden bg-[#0b141a] text-[#e9edef] outline-none"
        >
          <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-[#111b21] px-3 sm:h-16 sm:px-5">
            <button
              type="button"
              onClick={onCancel}
              disabled={isProcessing}
              aria-label="Cancelar recorte"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#aebac1] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <X className="h-6 w-6" />
            </button>
            <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-medium text-[#e9edef] sm:text-base">
              Recortar foto
            </Dialog.Title>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={() => setRotation((r) => (r + 90) % 360)}
                disabled={isProcessing}
                aria-label="Rotar 90°"
                title="Rotar 90°"
                className="flex h-10 w-10 items-center justify-center rounded-full text-[#aebac1] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                <RotateCcw className="h-5 w-5" />
              </button>
            </div>
          </header>

          <div className="relative min-h-0 flex-1 bg-black">
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

          <footer className="shrink-0 border-t border-white/10 bg-[#111b21] px-4 pb-safe pt-4 sm:px-6">
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
              <div className="flex items-center gap-3">
                <span className="text-xs font-medium text-[#aebac1]">Zoom</span>
                <input
                  type="range"
                  aria-label="Zoom"
                  min={1}
                  max={3}
                  step={0.01}
                  value={zoom}
                  onChange={(e) => setZoom(Number(e.target.value))}
                  className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-[#374248] accent-[#00a884]"
                />
              </div>

              <div className="flex items-end justify-between gap-3 pb-4">
                <div className="flex flex-wrap gap-2">
                  {ASPECT_OPTIONS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onClick={() => setAspect(option.value)}
                      disabled={isProcessing}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        aspect === option.value
                          ? 'border-[#00a884] bg-[#00a884] text-white'
                          : 'border-white/10 bg-[#202c33] text-[#d1d7db] hover:bg-[#2a3942]'
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
                  className="flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-[#00a884] px-5 text-sm font-semibold text-white shadow-lg transition-colors hover:bg-[#06cf9c] disabled:cursor-wait disabled:opacity-60"
                >
                  {isProcessing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
                  <span className="hidden sm:inline">Listo</span>
                </button>
              </div>
            </div>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
