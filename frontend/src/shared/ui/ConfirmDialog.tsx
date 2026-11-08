import * as AlertDialog from '@radix-ui/react-alert-dialog'
import type { ReactNode } from 'react'
import { Button } from './Button'

interface ConfirmDialogProps {
  /** Con `open`/`onOpenChange` (modo controlado, ej. desde un menú contextual
   * que ya se cerró) no hace falta un trigger propio: se omite. */
  children?: ReactNode
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  disabled?: boolean
  /** Contenido debajo de la descripción (p. ej. qué impide confirmar). */
  details?: ReactNode
  /** Deshabilita solo el botón de confirmar, no el que abre el diálogo. */
  confirmDisabled?: boolean
  onConfirm: () => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/** Confirmación accesible con foco atrapado y cierre por Escape. Nunca más
 *  alta que la pantalla: con contenido largo (`details`) hace scroll adentro;
 *  antes crecía hacia abajo y lo último quedaba fuera de la vista. */
export function ConfirmDialog({
  children,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  confirmVariant = 'danger',
  disabled,
  details,
  confirmDisabled,
  onConfirm,
  open,
  onOpenChange,
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      {children && <AlertDialog.Trigger asChild disabled={disabled}>{children}</AlertDialog.Trigger>}
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-[1px] data-[state=closed]:animate-out data-[state=open]:animate-in" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[131] max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-2xl border border-wa-border bg-white p-5 text-wa-text shadow-2xl outline-none dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark">
          <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm leading-relaxed text-wa-muted dark:text-wa-muted-dark">
            {description}
          </AlertDialog.Description>
          {details}
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild><Button variant="ghost">{cancelLabel}</Button></AlertDialog.Cancel>
            <AlertDialog.Action asChild><Button variant={confirmVariant} onClick={onConfirm} disabled={confirmDisabled}>{confirmLabel}</Button></AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
