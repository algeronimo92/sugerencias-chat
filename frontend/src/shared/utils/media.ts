import { resolveMediaUrl } from './mediaUrl'

function safeDownloadName(value: string): string {
  const basename = value.replace(/\\/g, '/').split('/').pop() ?? ''
  const cleaned = Array.from(basename, character => {
    const code = character.charCodeAt(0)
    return code < 32 || code === 127 || character === '"' ? '_' : character
  }).join('').trim()
  return cleaned || 'archivo'
}

/** URL que pide el archivo como adjunto al backend. Es preferible a descargar
 * primero un Blob en memoria: videos grandes no duplican RAM en el celular y
 * Content-Disposition funciona aunque Vite y la API usen puertos distintos. */
export function mediaDownloadUrl(src: string, filename: string): string {
  if (/^(?:data:|blob:)/i.test(src)) return src
  try {
    const url = new URL(src, window.location.href)
    if (url.pathname.startsWith('/media/')) url.searchParams.set('download', safeDownloadName(filename))
    return url.toString()
  } catch {
    return src
  }
}

/** Inicia una descarga sin sacar al usuario del chat. Para URLs externas que
 * no controla la API se abre una pestaña de respaldo, porque esos servidores
 * pueden ignorar el atributo ``download``. */
export function triggerMediaDownload(src: string, filename: string): void {
  const resolved = resolveMediaUrl(src) ?? src
  const href = mediaDownloadUrl(resolved, filename)
  const anchor = document.createElement('a')
  anchor.href = href
  anchor.download = safeDownloadName(filename)
  anchor.rel = 'noopener noreferrer'
  try {
    const url = new URL(href, window.location.href)
    if (!url.pathname.startsWith('/media/') && url.origin !== window.location.origin) anchor.target = '_blank'
  } catch {
    // data:/blob: no necesitan un tratamiento adicional.
  }
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
}

/** Comprime una imagen en el navegador antes de subirla, como hace WhatsApp:
 * la reescala a un lado máximo y la re-encoda como JPEG. Evita el error de
 * "archivo demasiado grande" con fotos de celular (3-12 MB → <1 MB) sin pérdida
 * visible.
 *
 * Solo actúa sobre imágenes grandes (> minBytes) y solo si el resultado pesa
 * menos que el original; ante cualquier problema (formato no rasterizable como
 * HEIC en algunos navegadores) devuelve el archivo original sin tocarlo. */
export async function compressImage(
  file: File,
  { maxDimension = 2048, quality = 0.82, minBytes = 1_000_000 }: {
    maxDimension?: number
    quality?: number
    minBytes?: number
  } = {},
): Promise<File> {
  if (!file.type.startsWith('image/') || file.size <= minBytes) return file
  try {
    const bitmap = await createImageBitmap(file)
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height))
    const width = Math.round(bitmap.width * scale)
    const height = Math.round(bitmap.height * scale)
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return file
    }
    ctx.drawImage(bitmap, 0, 0, width, height)
    bitmap.close()
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
    if (!blob || blob.size >= file.size) return file
    const name = file.name.replace(/\.[^.]+$/, '') + '.jpg'
    return new File([blob], name, { type: 'image/jpeg' })
  } catch {
    return file
  }
}
