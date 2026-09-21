import { useEffect, useRef, useState } from 'react'
import { Camera, Loader2, SwitchCamera, X } from 'lucide-react'
import { DialogPrimitive as Dialog } from './ui/Dialog'

type Facing = 'environment' | 'user'

/** Igual que describeMicError en VoiceRecorder: getUserMedia falla con nombres
 * de error fijos (DOMException.name) y cada uno se resuelve distinto. */
function describeCameraError(err: unknown): string {
  const name = err instanceof DOMException ? err.name : ''

  if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
    return (
      'El navegador tiene bloqueado el acceso a la cámara para este sitio. ' +
      'Para habilitarlo: hacé click en el ícono de candado (o de información) a la ' +
      'izquierda de la URL → "Permisos del sitio" → Cámara → Permitir, y volvé a cargar la página.'
    )
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No se encontró ninguna cámara conectada a este dispositivo.'
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'La cámara está siendo usada por otra aplicación. Cerrala e intentá de nuevo.'
  }
  if (name === 'OverconstrainedError') {
    return 'La cámara elegida no está disponible en este dispositivo.'
  }
  if (name === 'SecurityError') {
    return 'Tomar fotos requiere una conexión segura (HTTPS) para este sitio.'
  }
  return 'No se pudo acceder a la cámara. Revisá los permisos del navegador para este sitio y volvé a cargar la página.'
}

/** `foto-20260919-143012.jpg`: el nombre acompaña al archivo hasta WhatsApp o
 * hasta el comprobante de la cita, así que conviene que sea legible y
 * ordenable por fecha. */
function captureFilename(prefix: string): string {
  const now = new Date()
  const pad = (value: number) => value.toString().padStart(2, '0')
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  return `${prefix}-${stamp}.jpg`
}

/**
 * Obturador estilo WhatsApp: muestra el video en vivo y al disparar entrega un
 * File JPEG. No manda ni sube nada por su cuenta — quien lo abre decide qué
 * hacer con la foto, de modo que siga el mismo camino que un archivo elegido
 * del disco (en el chat, la pantalla de previsualización con epígrafe, recorte
 * y dibujo; en Nueva cita, el adjunto del comprobante).
 */
export function CameraCaptureDialog({
  onCapture,
  onClose,
  title = 'Tomar foto',
  filenamePrefix = 'foto',
  // El chat lo abre dentro de su panel (que es `relative`), así la conversación
  // sigue enmarcada; una página suelta no tiene ese panel y necesita `fixed`.
  cover = 'container',
}: {
  onCapture: (file: File) => void
  onClose: () => void
  title?: string
  filenamePrefix?: string
  cover?: 'container' | 'viewport'
}) {
  const [status, setStatus] = useState<'requesting' | 'ready' | 'error'>('requesting')
  const [error, setError] = useState<string | null>(null)
  const [facing, setFacing] = useState<Facing>('environment')
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false)
  const [isCapturing, setIsCapturing] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  // La cámara frontal se ve espejada (es lo que espera cualquiera que se mire
  // en la pantalla); la foto se captura igual que la vista previa para que lo
  // que se manda sea exactamente lo que se vio.
  const isMirrored = facing === 'user'

  useEffect(() => {
    let cancelled = false
    let stream: MediaStream | null = null

    async function openCamera() {
      setStatus('requesting')
      setError(null)
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          // `ideal` y no `exact`: en una laptop con una sola webcam, exigir la
          // cámara trasera falla con OverconstrainedError en vez de usarla.
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: false,
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          // `autoPlay` ya lo arranca; si el navegador bloquea la reproducción
          // automática no hay que tratarlo como un fallo de la cámara.
          try {
            await video.play()
          } catch {
            // ignorado a propósito
          }
        }
        setStatus('ready')
        // Los labels recién existen con el permiso concedido, pero para contar
        // cuántas cámaras hay alcanza con el kind.
        const devices = await navigator.mediaDevices.enumerateDevices().catch(() => [])
        if (!cancelled) {
          setHasMultipleCameras(devices.filter((device) => device.kind === 'videoinput').length > 1)
        }
      } catch (err) {
        if (cancelled) return
        setStatus('error')
        setError(describeCameraError(err))
      }
    }

    void openCamera()

    return () => {
      cancelled = true
      // Sin esto queda encendida la luz de la cámara después de cerrar.
      stream?.getTracks().forEach((track) => track.stop())
    }
  }, [facing])

  function handleCapture() {
    const video = videoRef.current
    if (!video || status !== 'ready' || isCapturing) return
    const width = video.videoWidth
    const height = video.videoHeight
    if (!width || !height) return

    setIsCapturing(true)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      setIsCapturing(false)
      setError('Este navegador no puede procesar la foto.')
      return
    }
    if (isMirrored) {
      ctx.translate(width, 0)
      ctx.scale(-1, 1)
    }
    ctx.drawImage(video, 0, 0, width, height)
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setIsCapturing(false)
          setError('No se pudo capturar la foto. Intentá de nuevo.')
          return
        }
        // El padre cierra este diálogo y abre la preview con la foto.
        onCapture(new File([blob], captureFilename(filenamePrefix), { type: 'image/jpeg' }))
      },
      'image/jpeg',
      0.92,
    )
  }

  const layerClass = cover === 'viewport' ? 'fixed inset-0 z-50' : 'absolute inset-0 z-42'

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onClose() }}>
      <Dialog.Overlay className={`${layerClass} bg-black/85 data-[state=open]:animate-in data-[state=closed]:animate-out`} />
      <Dialog.Content
        aria-describedby={undefined}
        className={`${layerClass} flex h-full w-full flex-col overflow-hidden bg-wa-chat-dark text-[#e9edef] outline-none`}
      >
        <header className="flex h-14 shrink-0 items-center gap-3 border-b border-white/10 bg-[#111b21] px-3 sm:h-16 sm:px-5">
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar cámara"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#aebac1] transition-colors hover:bg-white/10 hover:text-white"
          >
            <X className="h-6 w-6" />
          </button>
          <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-medium text-[#e9edef] sm:text-base">
            {title}
          </Dialog.Title>
          {hasMultipleCameras && (
            <button
              type="button"
              onClick={() => setFacing((current) => (current === 'environment' ? 'user' : 'environment'))}
              disabled={isCapturing}
              aria-label="Cambiar de cámara"
              title="Cambiar de cámara"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#aebac1] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
            >
              <SwitchCamera className="h-5 w-5" />
            </button>
          )}
        </header>

        <div className="relative min-h-0 flex-1 bg-black">
          <video
            ref={videoRef}
            playsInline
            muted
            autoPlay
            aria-label="Vista previa de la cámara"
            className={`h-full w-full object-contain ${isMirrored ? '-scale-x-100' : ''}`}
          />
          {status === 'requesting' && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-[#aebac1]" />
              <p className="text-sm text-[#aebac1]">Pidiendo permiso para usar la cámara...</p>
            </div>
          )}
          {status === 'error' && error && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
              <p className="max-w-md text-sm text-[#e9edef]">{error}</p>
              <button
                type="button"
                onClick={onClose}
                className="rounded-full border border-white/20 px-4 py-1.5 text-xs font-medium text-[#d1d7db] transition-colors hover:bg-white/10"
              >
                Cerrar
              </button>
            </div>
          )}
        </div>

        <footer className="shrink-0 border-t border-white/10 bg-[#111b21] px-4 pb-safe pt-4 sm:px-6">
          <div className="mx-auto flex w-full max-w-3xl items-center justify-center pb-4">
            <button
              type="button"
              onClick={handleCapture}
              disabled={status !== 'ready' || isCapturing}
              aria-label="Tomar foto"
              className="flex h-16 w-16 items-center justify-center rounded-full bg-wa-primary text-white shadow-lg ring-4 ring-white/15 transition-colors hover:bg-[#06cf9c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isCapturing ? <Loader2 className="h-7 w-7 animate-spin" /> : <Camera className="h-7 w-7" />}
            </button>
          </div>
        </footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}
