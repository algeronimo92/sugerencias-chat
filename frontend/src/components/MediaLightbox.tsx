import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Video, X } from 'lucide-react'
import { VideoPlayer } from './MediaPlayer'

export interface MediaLightboxItem {
  src: string
  kind: 'image' | 'video'
  alt: string
}

interface Props {
  src: string
  kind: 'image' | 'video'
  alt?: string
  onClose: () => void
  items?: MediaLightboxItem[]
}

const MIN_SCALE = 1
const MAX_SCALE = 4
const WHEEL_ZOOM_STEP = 0.4
const CLICK_ZOOM_SCALE = 2.5

export function MediaLightbox({ src, kind, alt, onClose, items }: Props) {
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const draggingRef = useRef(false)
  const movedRef = useRef(false)
  const lastPosRef = useRef({ x: 0, y: 0 })
  const imgRef = useRef<HTMLImageElement>(null)
  const mediaItems = items?.length ? items : [{ src, kind, alt: alt || (kind === 'image' ? 'Imagen' : 'Video') }]
  const initialIndex = Math.max(0, mediaItems.findIndex(item => item.src === src && item.kind === kind))
  const [activeIndex, setActiveIndex] = useState(initialIndex)
  const activeMedia = mediaItems[activeIndex] ?? mediaItems[0]
  const hasGallery = mediaItems.length > 1

  useEffect(() => {
    setActiveIndex(initialIndex)
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [initialIndex, src, kind])

  function selectMedia(index: number) {
    setActiveIndex(index)
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }

  const moveMedia = useCallback((direction: -1 | 1) => {
    setActiveIndex(index => (index + direction + mediaItems.length) % mediaItems.length)
    setScale(1)
    setOffset({ x: 0, y: 0 })
  }, [mediaItems.length])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      }
      if (hasGallery && e.key === 'ArrowLeft') {
        e.preventDefault()
        moveMedia(-1)
      }
      if (hasGallery && e.key === 'ArrowRight') {
        e.preventDefault()
        moveMedia(1)
      }
    }
    // Captura para adelantarse al listener global de Escape (que cierra el
    // lead abierto): si el lightbox está abierto, Escape debe cerrarlo a él
    // primero, no el panel de atrás.
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [onClose, hasGallery, moveMedia])

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
    }
  }, [activeMedia.kind])

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

      {activeMedia.kind === 'image' ? (
        <img
          ref={imgRef}
          src={activeMedia.src}
          alt={activeMedia.alt}
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
        <VideoPlayer src={activeMedia.src} autoPlay className="h-[78vh] w-[92vw] max-w-6xl" ariaLabel={activeMedia.alt || 'Video ampliado'} />
      )}

      {hasGallery && (
        <>
          <button type="button" onClick={event => { event.stopPropagation(); moveMedia(-1) }} aria-label="Multimedia anterior" title="Anterior" className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70 sm:left-6"><ChevronLeft className="h-6 w-6" /></button>
          <button type="button" onClick={event => { event.stopPropagation(); moveMedia(1) }} aria-label="Siguiente multimedia" title="Siguiente" className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white transition-colors hover:bg-black/70 sm:right-6"><ChevronRight className="h-6 w-6" /></button>
          <div className="absolute bottom-4 left-1/2 flex max-w-[82vw] -translate-x-1/2 items-center gap-1.5 overflow-x-auto rounded-xl bg-black/45 p-1.5 backdrop-blur-sm">
            {mediaItems.map((item, index) => (
              <button
                key={`${item.src}-${index}`}
                type="button"
                onClick={event => { event.stopPropagation(); selectMedia(index) }}
                aria-label={`Ver ${item.kind === 'image' ? 'imagen' : 'video'} ${index + 1}`}
                aria-current={index === activeIndex ? 'true' : undefined}
                className={`relative h-12 w-12 shrink-0 overflow-hidden rounded-md transition-all ${index === activeIndex ? 'ring-2 ring-wa-primary ring-offset-1 ring-offset-black' : 'opacity-65 hover:opacity-100'}`}
              >
                {item.kind === 'image'
                  ? <img src={item.src} alt="" className="h-full w-full object-cover" />
                  : <><video src={item.src} muted preload="metadata" className="h-full w-full bg-black object-cover" /><span className="absolute inset-0 flex items-center justify-center bg-black/25 text-white"><Video className="h-4 w-4 fill-current" /></span></>}
              </button>
            ))}
          </div>
          <span className="absolute bottom-20 left-1/2 -translate-x-1/2 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-medium text-white">{activeIndex + 1} de {mediaItems.length}</span>
        </>
      )}
    </div>
  )
}
