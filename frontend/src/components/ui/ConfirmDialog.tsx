import * as AlertDialog from '@radix-ui/react-alert-dialog'
import type { ReactNode } from 'react'
import { Button } from './Button'

interface ConfirmDialogProps {
  children: ReactNode
  title: string
  description: string
  confirmLabel?: string
  cancelLabel?: string
  confirmVariant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  disabled?: boolean
  onConfirm: () => void
}

/** Confirmación accesible con foco atrapado y cierre por Escape. */
export function ConfirmDialog({
  children,
  title,
  description,
  confirmLabel = 'Confirmar',
  cancelLabel = 'Cancelar',
  confirmVariant = 'danger',
  disabled,
  onConfirm,
}: ConfirmDialogProps) {
  return (
    <AlertDialog.Root>
      <AlertDialog.Trigger asChild disabled={disabled}>{children}</AlertDialog.Trigger>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className="fixed inset-0 z-[130] bg-black/60 backdrop-blur-[1px] data-[state=closed]:animate-out data-[state=open]:animate-in" />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-[131] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-wa-border bg-white p-5 text-wa-text shadow-2xl outline-none dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark">
          <AlertDialog.Title className="text-base font-semibold">{title}</AlertDialog.Title>
          <AlertDialog.Description className="mt-2 text-sm leading-relaxed text-wa-muted dark:text-wa-muted-dark">
            {description}
          </AlertDialog.Description>
          <div className="mt-5 flex justify-end gap-2">
            <AlertDialog.Cancel asChild><Button variant="ghost">{cancelLabel}</Button></AlertDialog.Cancel>
            <AlertDialog.Action asChild><Button variant={confirmVariant} onClick={onConfirm}>{confirmLabel}</Button></AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
