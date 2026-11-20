import { X } from 'lucide-react'
import { Button } from '../../../../shared/ui/Button'
import { DialogPrimitive as Dialog } from '../../../../shared/ui/Dialog'
import type { ChatFiltersState } from '../../layoutContext'
import { InboxSections } from './InboxSections'

interface Props {
  filters: ChatFiltersState
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Las bandejas en el celular (doc 18 §6.5): una hoja que sube desde abajo,
 * con asa, las mismas secciones que la columna de escritorio y un botón al
 * pie para volver a la lista. Elegir una bandeja no la cierra: se pueden
 * combinar una bandeja, una vista y una etapa antes de volver.
 *
 * Capa z-[87]/z-[88], la de lo que se abre encima de la barra inferior
 * (z-86): con la capa común la hoja quedaba detrás de la barra.
 */
export function InboxSheet({ filters, open, onOpenChange }: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[87] bg-scrim data-[state=closed]:animate-out data-[state=open]:animate-in" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-[88] flex max-h-[85dvh] flex-col rounded-t-2xl bg-surface-raised pb-safe shadow-overlay outline-none"
        >
          <div className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-line-control/50" aria-hidden="true" />
          <div className="flex h-12 shrink-0 items-center justify-between px-5">
            <Dialog.Title className="text-base font-semibold text-fg">Bandejas</Dialog.Title>
            <Dialog.Close
              aria-label="Cerrar"
              className="-mr-2 flex h-10 w-10 items-center justify-center rounded-lg text-fg-muted outline-none hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
            >
              <X className="h-5 w-5" aria-hidden="true" />
            </Dialog.Close>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <InboxSections filters={filters} />
          </div>
          <div className="shrink-0 border-t border-line px-4 py-3">
            <Button size="lg" className="w-full" onClick={() => onOpenChange(false)}>
              Ver conversaciones
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
