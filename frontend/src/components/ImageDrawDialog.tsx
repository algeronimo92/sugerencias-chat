import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Check, Loader2, Trash2, Undo2, X } from 'lucide-react'
import { DialogPrimitive as Dialog } from './ui/Dialog'

type Point = { x: number; y: number }
type Stroke = { color: string; width: number; points: Point[] }

const COLORS = [
  { value: '#3b3b3b', label: 'Gris oscuro' },
  { value: '#aeb4bd', label: 'Gris claro' },
  { value: '#ffffff', label: 'Blanco' },
  { value: '#29b6f6', label: 'Celeste' },
  { value: '#55dc24', label: 'Verde' },
  { value: '#ad62e8', label: 'Morado' },
  { value: '#ff941f', label: 'Naranja' },
  { value: '#ff4d4f', label: 'Rojo' },
] as const

const BRUSH_SIZES = [
  { value: 3, label: 'Fino' },
  { value: 7, label: 'Medio' },
  { value: 14, label: 'Grueso' },
  { value: 24, label: 'Muy grueso' },
] as const

function drawStroke(context: CanvasRenderingContext2D, stroke: Stroke) {
  const first = stroke.points[0]
  if (!first) return

  context.save()
  context.strokeStyle = stroke.color
  context.fillStyle = stroke.color
  context.lineWidth = stroke.width
  context.lineCap = 'round'
  context.lineJoin = 'round'

  if (stroke.points.length === 1) {
    context.beginPath()
    context.arc(first.x, first.y, stroke.width / 2, 0, Math.PI * 2)
    context.fill()
  } else {
    context.beginPath()
    context.moveTo(first.x, first.y)
    for (const point of stroke.points.slice(1)) context.lineTo(point.x, point.y)
    context.stroke()
  }
  context.restore()
}

function editedFilename(filename: string): string {
  return `${filename.replace(/\.[^.]+$/, '') || 'imagen'}.jpg`
}

/** Editor de trazos que compone el dibujo y la foto en un nuevo archivo.
 * Los puntos se guardan en coordenadas reales de la imagen, por lo que el
 * resultado conserva la resolución aunque el canvas se muestre reducido. */
export function ImageDrawDialog({
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
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const activeStrokeRef = useRef<Stroke | null>(null)
  const [strokes, setStrokes] = useState<Stroke[]>([])
  const [color, setColor] = useState<string>(COLORS[7].value)
  const [brushSize, setBrushSize] = useState<number>(BRUSH_SIZES[1].value)
  const [isReady, setIsReady] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function redraw(nextStrokes: Stroke[]) {
    const canvas = canvasRef.current
    const image = imageRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !image || !context) return
    context.clearRect(0, 0, canvas.width, canvas.height)
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    for (const stroke of nextStrokes) drawStroke(context, stroke)
  }

  useEffect(() => {
    let cancelled = false
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => {
      if (cancelled) return
      const canvas = canvasRef.current
      if (!canvas) return
      canvas.width = image.naturalWidth || image.width
      canvas.height = image.naturalHeight || image.height
      imageRef.current = image
      setError(null)
      setIsReady(true)
    }
    image.onerror = () => {
      if (!cancelled) setError('No se pudo preparar la imagen para dibujar.')
    }
    image.src = imageUrl
    return () => {
      cancelled = true
      imageRef.current = null
    }
  }, [imageUrl])

  useEffect(() => {
    if (isReady) redraw(strokes)
  }, [isReady, strokes])

  function pointFromEvent(event: ReactPointerEvent<HTMLCanvasElement>): Point | null {
    const canvas = canvasRef.current
    if (!canvas) return null
    const bounds = canvas.getBoundingClientRect()
    if (!bounds.width || !bounds.height) return null
    return {
      x: (event.clientX - bounds.left) * (canvas.width / bounds.width),
      y: (event.clientY - bounds.top) * (canvas.height / bounds.height),
    }
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!isReady || isProcessing) return
    const canvas = canvasRef.current
    const point = pointFromEvent(event)
    if (!canvas || !point) return
    event.preventDefault()
    canvas.setPointerCapture(event.pointerId)
    const bounds = canvas.getBoundingClientRect()
    const stroke: Stroke = {
      color,
      width: brushSize * (canvas.width / bounds.width),
      points: [point],
    }
    activeStrokeRef.current = stroke
    const context = canvas.getContext('2d')
    if (context) drawStroke(context, stroke)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    const stroke = activeStrokeRef.current
    const point = pointFromEvent(event)
    if (!canvas || !stroke || !point) return
    event.preventDefault()
    const previous = stroke.points.at(-1)
    stroke.points.push(point)
    if (!previous) return
    const context = canvas.getContext('2d')
    if (!context) return
    drawStroke(context, { ...stroke, points: [previous, point] })
  }

  function finishStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    const stroke = activeStrokeRef.current
    if (!stroke) return
    activeStrokeRef.current = null
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setStrokes((current) => [...current, stroke])
  }

  function undo() {
    setStrokes((current) => current.slice(0, -1))
  }

  function clear() {
    activeStrokeRef.current = null
    setStrokes([])
  }

  async function handleConfirm() {
    const canvas = canvasRef.current
    if (!canvas || !isReady || isProcessing) return
    setIsProcessing(true)
    setError(null)
    try {
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) throw new Error('No se pudo generar la imagen editada.')
      onConfirm(new File([blob], editedFilename(filename), { type: 'image/jpeg' }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo generar la imagen editada.')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !isProcessing) onCancel() }}>
      <Dialog.Overlay className="absolute inset-0 z-42 bg-black/85 data-[state=open]:animate-in data-[state=closed]:animate-out" />
      <Dialog.Content
        aria-describedby={undefined}
        onEscapeKeyDown={(event) => { if (isProcessing) event.preventDefault() }}
        onPointerDownOutside={(event) => { if (isProcessing) event.preventDefault() }}
        className="absolute inset-0 z-42 flex h-full w-full flex-col overflow-hidden bg-[#0b141a] text-[#e9edef] outline-none"
      >
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-white/10 bg-[#111b21] px-3 sm:h-16 sm:px-5">
          <button
            type="button"
            onClick={onCancel}
            disabled={isProcessing}
            aria-label="Cancelar dibujo"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#aebac1] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <X className="h-6 w-6" />
          </button>
          <Dialog.Title className="min-w-0 flex-1 truncate text-sm font-medium text-[#e9edef] sm:text-base">
            Dibujar en la foto
          </Dialog.Title>
          <button
            type="button"
            onClick={undo}
            disabled={isProcessing || strokes.length === 0}
            aria-label="Deshacer último trazo"
            title="Deshacer"
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#aebac1] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            <Undo2 className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={clear}
            disabled={isProcessing || strokes.length === 0}
            aria-label="Borrar todos los trazos"
            title="Borrar todo"
            className="flex h-10 w-10 items-center justify-center rounded-full text-[#aebac1] transition-colors hover:bg-white/10 hover:text-white disabled:opacity-30"
          >
            <Trash2 className="h-5 w-5" />
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={isProcessing || !isReady}
            aria-label="Confirmar dibujo"
            className="flex h-10 items-center justify-center gap-1.5 rounded-full px-3 font-semibold text-[#00a884] transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {isProcessing ? <Loader2 className="h-5 w-5 animate-spin" /> : <Check className="h-5 w-5" />}
            <span>Listo</span>
          </button>
        </header>

        <main className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-[#0b141a] p-3 sm:p-6">
          {!isReady && !error && <Loader2 className="h-8 w-8 animate-spin text-[#aebac1]" aria-label="Preparando imagen" />}
          {error && <p role="alert" className="rounded-lg bg-red-950/60 px-4 py-3 text-sm text-red-200">{error}</p>}
          <canvas
            ref={canvasRef}
            aria-label="Lienzo para dibujar sobre la imagen"
            className={`${isReady ? 'block' : 'hidden'} max-h-full max-w-full cursor-crosshair touch-none select-none object-contain shadow-2xl`}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishStroke}
            onPointerCancel={finishStroke}
          />
        </main>

        <footer className="shrink-0 border-t border-white/10 bg-[#111b21] px-4 pb-safe pt-3 sm:px-6">
          <div className="mx-auto flex min-h-20 w-full max-w-3xl flex-wrap items-center justify-center gap-x-6 gap-y-3 pb-3">
            <div className="flex items-center gap-2" aria-label="Colores del lápiz">
              {COLORS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setColor(option.value)}
                  disabled={isProcessing}
                  aria-label={`Color ${option.label}`}
                  aria-pressed={color === option.value}
                  title={option.label}
                  className={`h-7 w-7 rounded-full border-2 transition-transform hover:scale-110 disabled:opacity-50 ${
                    color === option.value ? 'scale-110 border-[#00a884] ring-2 ring-[#00a884]/35' : 'border-white/25'
                  }`}
                  style={{ backgroundColor: option.value }}
                />
              ))}
            </div>
            <span className="hidden h-8 w-px bg-white/15 sm:block" />
            <div className="flex items-center gap-2" aria-label="Grosor del lápiz">
              {BRUSH_SIZES.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setBrushSize(option.value)}
                  disabled={isProcessing}
                  aria-label={`Grosor ${option.label}`}
                  aria-pressed={brushSize === option.value}
                  title={option.label}
                  className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors disabled:opacity-50 ${
                    brushSize === option.value ? 'bg-white/15 ring-1 ring-[#00a884]' : 'hover:bg-white/10'
                  }`}
                >
                  <span className="rounded-full bg-[#d1d7db]" style={{ width: option.value, height: option.value }} />
                </button>
              ))}
            </div>
          </div>
        </footer>
      </Dialog.Content>
    </Dialog.Root>
  )
}
