import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

interface Props {
  src: string
  kind: 'image' | 'video'
  alt?: string
  onClose: () => void
}

const MIN_SCALE = 1
const MAX_SCALE = 4
const WHEEL_ZOOM_STEP = 0.4
const CLICK_ZOOM_SCALE = 2.5

export function MediaLightbox({ src, kind, alt, onClose }: Props) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const draggingRef = useRef(false)
  const movedRef = useRef(false)
  const lastPosRef = useRef({ x: 0, y: 0 })
  const imgRef = useRef<HTMLImageElement>(null)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
    }
    // Captura para adelantarse al listener global de Escape (que cierra el
    // lead abierto): si el lightbox está abierto, Escape debe cerrarlo a él
    // primero, no el panel de atrás.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose])

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [])

  function resetZoom() {
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }

  function handleImageClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (movedRef.current) {
      movedRef.current = false
      return
    }
    if (scale > 1) {
      resetZoom()
    } else {
      setScale(CLICK_ZOOM_SCALE)
    }
  }

  // React trata onWheel como un listener pasivo por default, así que
  // event.preventDefault() ahí no frena el scroll de la página y solo tira
  // un warning en consola. Hace falta un listener nativo no-pasivo para que
  // el wheel realmente controle el zoom sin scrollear el fondo.
  useEffect(() => {
    const el = imgRef.current
    if (!el) return

    function onWheelNative(e: WheelEvent) {
      e.preventDefault()
      e.stopPropagation()
      setScale((s) => {
        const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, s - Math.sign(e.deltaY) * WHEEL_ZOOM_STEP))
        if (next === MIN_SCALE) setOffset({ x: 0, y: 0 })
        return next
      })
    }

    el.addEventListener('wheel', onWheelNative, { passive: false })
    return () => el.removeEventListener('wheel', onWheelNative)
  }, [])

  function handlePointerDown(e: React.PointerEvent<HTMLImageElement>) {
    if (scale <= 1) return
    draggingRef.current = true
    movedRef.current = false
    setIsDragging(true)
    lastPosRef.current = { x: e.clientX, y: e.clientY }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function handlePointerMove(e: React.PointerEvent<HTMLImageElement>) {
    if (!draggingRef.current) return
    const dx = e.clientX - lastPosRef.current.x
    const dy = e.clientY - lastPosRef.current.y
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) movedRef.current = true
    lastPosRef.current = { x: e.clientX, y: e.clientY }
    setOffset((o) => ({ x: o.x + dx, y: o.y + dy }))
  }

  function handlePointerUp() {
    draggingRef.current = false
    setIsDragging(false)
  }

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center overflow-hidden"
      onClick={onClose}
    >
      <button
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        aria-label="Cerrar"
        className="absolute top-4 right-4 w-9 h-9 flex items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 transition-colors"
      >
        <X className="w-5 h-5" />
      </button>

      {kind === 'image' ? (
        <img
          ref={imgRef}
          src={src}
          alt={alt || 'Imagen'}
          onClick={handleImageClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          draggable={false}
          className="max-w-[92vw] max-h-[92vh] object-contain select-none"
          style={{
            cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.2s ease-out',
          }}
        />
      ) : (
        <video
          src={src}
          controls
          autoPlay
          onClick={(e) => e.stopPropagation()}
          className="max-w-[92vw] max-h-[92vh]"
        />
      )}
    </div>
  )
}
