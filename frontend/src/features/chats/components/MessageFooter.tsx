import { BookmarkPlus } from 'lucide-react'
import type { ReactNode } from 'react'
import { formatMessageTime } from '../../whatsapp/public/message'

interface Props {
  sentAt: string | null
  editedAt?: string | null
  /** Solo en mensajes de texto propios: guarda el texto como plantilla personal. */
  onSaveTemplate?: () => void
  /** Sobre el reproductor de video el pie hereda el blanco del degradado. */
  overlay?: boolean
  className?: string
  /** Los ticks de estado, cuando el mensaje es del negocio. */
  children?: ReactNode
}

/**
 * Pie de burbuja: hora, "Editado", estado y la acción de guardar plantilla.
 *
 * Es uno solo para las cuatro burbujas (texto/media, video, álbum y vista
 * rápida) porque antes cada una tenía el suyo a 10 px y con `wa-faint` sobre
 * el verde del mensaje saliente, que da 2,75:1 de contraste: ilegible para
 * mucha gente y por debajo de WCAG AA. A 12 px y con `wa-faint-strong`
 * (5,06:1 en claro; en oscuro basta `wa-muted-dark`, 6,10:1) se lee. El botón
 * de guardar mide 24 px porque a 16 no se acertaba en táctil, y la hora de la
 * edición se expone como texto para lectores de pantalla y no solo en `title`.
 */
export function MessageFooter({ sentAt, editedAt, onSaveTemplate, overlay = false, className = '', children }: Props) {
  const tone = overlay ? '' : 'text-wa-faint-strong dark:text-wa-muted-dark'
  return (
    <span className={`flex items-center justify-end gap-1 text-xs leading-4 ${tone} ${className}`.trim()}>
      {onSaveTemplate && (
        <button
          type="button"
          aria-label="Guardar como plantilla personal"
          title="Guardar como plantilla personal"
          onClick={onSaveTemplate}
          className="mr-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md opacity-60 transition-opacity hover:bg-black/5 hover:text-wa-primary-strong hover:opacity-100 focus-visible:opacity-100 dark:hover:bg-white/10 dark:hover:text-wa-primary"
        >
          <BookmarkPlus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
      {editedAt && (
        <>
          <span title={`Editado ${formatMessageTime(editedAt)}`}>Editado</span>
          <span className="sr-only">a las {formatMessageTime(editedAt)}</span>
        </>
      )}
      <span>{formatMessageTime(sentAt)}</span>
      {children}
    </span>
  )
}
