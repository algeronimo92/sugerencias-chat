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
