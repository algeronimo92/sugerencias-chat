/**
 * Fuente de una imagen de la biblioteca para una tarjeta: pide la miniatura
 * reducida del backend (unos KB) y, si esa falla (404 porque no se pudo
 * generar, backend viejo), reintenta con el original antes de dar por
 * perdida la vista previa. Lo comparten la pestaña Adjuntos, la grilla de
 * Archivos y el selector de adjuntos, que antes bajaban el original entero.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { resolveMediaUrl, thumbnailUrl } from '../../../shared/utils/mediaUrl'

interface Handlers {
  /** Ya hay píxeles en pantalla: quien pinta retira su placeholder. */
  onLoad: () => void
  /** Ni la miniatura ni el original cargaron. */
  onFail: () => void
  /** Falso para un PDF: su original no es una imagen, así que sin miniatura
   * no hay nada que reintentar. Por defecto, verdadero. */
  fallbackToOriginal?: boolean
}

export function useImageThumbnail(mediaUrl: string, { onLoad, onFail, fallbackToOriginal = true }: Handlers) {
  const original = resolveMediaUrl(mediaUrl) ?? ''
  const thumbnail = thumbnailUrl(mediaUrl)
  const [useOriginal, setUseOriginal] = useState(thumbnail === null)
  const ref = useRef<HTMLImageElement>(null)
  const src = useOriginal ? original : thumbnail ?? original
  // Una imagen que ya estaba en caché puede completarse antes de que React
  // enganche onLoad: sin esto el placeholder se quedaría pulsando para siempre.
  useEffect(() => {
    const image = ref.current
    if (image?.complete && image.naturalWidth > 0) onLoad()
  }, [src, onLoad])
  const onError = useCallback(() => {
    if (useOriginal || !fallbackToOriginal) onFail()
    else setUseOriginal(true)
  }, [useOriginal, fallbackToOriginal, onFail])
  return { ref, src, onLoad, onError }
}
