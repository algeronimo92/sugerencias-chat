import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../utils/cn'
import { DialogPrimitive as Dialog } from './Dialog'

const SIZES = {
  sm: 'max-w-md',
  md: 'max-w-lg',
  lg: 'max-w-2xl',
} as const

// `overFullscreen`: encima de una vista de pantalla completa (el editor de
// flujos, z-[60]). `confirm`: la misma capa que ConfirmDialog, para una
// pregunta que tiene que quedar arriba de todo.
const LAYERS = {
  overFullscreen: { overlay: 'z-[75]', content: 'z-[76]' },
  confirm: { overlay: 'z-[130]', content: 'z-[131]' },
} as const

interface ModalProps {
  title: ReactNode
  /** Una línea que dice para qué es. El detalle va en el cuerpo. */
  description?: ReactNode
  icon?: ReactNode
  size?: keyof typeof SIZES
  layer?: keyof typeof LAYERS
  /** Una pregunta que hay que contestar (Escape cuenta como cancelar). */
  alert?: boolean
  /** Mientras guarda: no se cierra con Escape, clic afuera ni la X. */
  busy?: boolean
  onClose: () => void
  /** Los botones, en orden de lectura: el principal va último. */
  footer?: ReactNode
  children?: ReactNode
}

/**
 * El armazón común de un modal: cabecera con título y X, cuerpo con scroll
 * propio y pie con las acciones alineadas a la derecha (2026-11-18).
 *
 * Antes cada modal del editor de flujos se armaba a mano y había tres
 * formas: pie partido en dos botones a todo el ancho, botones sueltos y
 * `div`s fijos que no se cerraban con Escape ni retenían el foco. Este usa
 * Radix, así que todos atrapan el foco, se cierran con Escape y se anuncian
 * como diálogo (lo que mira `hasOpenOverlay`).
 */
export function Modal({
  title, description, icon, size = 'sm', layer = 'overFullscreen', alert = false, busy = false, onClose, footer, children,
}: ModalProps) {
  const z = LAYERS[layer]
  const block = (event: Event) => { if (busy) event.preventDefault() }
  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={cn('fixed inset-0 bg-black/60 backdrop-blur-[1px] data-[state=closed]:animate-out data-[state=open]:animate-in', z.overlay)} />
        <Dialog.Content
          role={alert ? 'alertdialog' : 'dialog'}
          onEscapeKeyDown={block}
          onPointerDownOutside={block}
          onInteractOutside={block}
          className={cn(
            'fixed left-1/2 top-1/2 flex max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-wa-border bg-white text-wa-text shadow-2xl outline-none dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark',
            SIZES[size], z.content,
          )}
        >
          <div className="flex items-start gap-3 px-5 pb-3 pt-5">
            {icon && <span aria-hidden="true" className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-wa-primary/10 text-wa-primary-strong dark:text-wa-primary">{icon}</span>}
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold leading-snug">{title}</Dialog.Title>
              {description
                ? <Dialog.Description className="mt-1 text-sm leading-relaxed text-wa-muted dark:text-wa-muted-dark">{description}</Dialog.Description>
                : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              aria-label="Cerrar"
              className="-mr-1.5 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-wa-muted outline-none transition-colors hover:bg-wa-hover hover:text-wa-text focus-visible:ring-2 focus-visible:ring-wa-primary/60 disabled:opacity-40 dark:hover:bg-wa-hover-dark dark:hover:text-wa-text-dark"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          {children != null && <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 pt-1">{children}</div>}
          {footer && (
            <div className="flex flex-col-reverse gap-2 border-t border-wa-border px-5 py-3.5 sm:flex-row sm:justify-end dark:border-wa-border-dark">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
