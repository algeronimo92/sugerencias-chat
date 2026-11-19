import { uploadSizeError } from '../../../shared/utils/media'

/** Qué archivos admite una plantilla interna. Lo comparten la pantalla de
 *  Plantillas y el diálogo de edición del flujo, para que no diverjan. */
export const ACCEPTED_ATTACHMENT_TYPES = 'image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip'

const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'webm', 'mov', 'mp3', 'wav', 'ogg', 'm4a',
  'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'txt', 'zip',
])

export function validateAttachmentFile(file: File): string | null {
  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toLowerCase() ?? '' : ''
  if (!file.size) return `${file.name}: el archivo está vacío.`
  const sizeError = uploadSizeError(file)
  if (sizeError) return `${file.name}: ${sizeError}.`
  if (file.name.length > 255) return `${file.name}: el nombre admite máximo 255 caracteres.`
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) return `${file.name}: tipo de archivo no permitido.`
  return null
}

export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
