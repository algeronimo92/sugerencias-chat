import { useState } from 'react'
import { X } from 'lucide-react'
import { Button } from './ui/Button'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './ui/Dialog'
import { Textarea, labelClass } from './ui/Input'

interface Props {
  /** Cuántos leads se están moviendo: 1 en el drag, N en la selección múltiple. */
  count: number
  onConfirm: (razon: string | null) => void
  onCancel: () => void
}

/** Se pide la razón al mandar un lead a Perdido, pero no se exige: dejarla en
 * blanco mueve el lead igual. La razón queda en el lead y, sobre todo, en el
 * historial del chat (metadata.reason de la tarjeta de cambio de estado). */
export function LostReasonDialog({ count, onConfirm, onCancel }: Props) {
  const [razon, setRazon] = useState('')
  const trimmed = razon.trim()

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content asChild>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              onConfirm(trimmed || null)
            }}
            className={`${dialogContentPositionClass} w-[calc(100%-2rem)] max-w-sm overflow-hidden rounded-xl border border-wa-border bg-white shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}
          >
            <div className="flex items-center justify-between border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
              <Dialog.Title className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">
                {count > 1 ? `Mover ${count} leads a Perdido` : 'Mover a Perdido'}
              </Dialog.Title>
              <button
                type="button"
                onClick={onCancel}
                aria-label="Cerrar"
                className="text-wa-muted transition-colors hover:text-gray-600 dark:hover:text-gray-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-4 py-3">
              <label className={labelClass}>¿Por qué se perdió?</label>
              <Textarea
                value={razon}
                onChange={(e) => setRazon(e.target.value)}
                rows={3}
                maxLength={500}
                autoFocus
                placeholder="Precio, se fue con la competencia, no contesta…"
                className="resize-none"
              />
              <p className="mt-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">
                Opcional. Queda en la ficha y en el historial del chat.
              </p>
            </div>

            <div className="flex border-t border-wa-border dark:border-wa-border-dark">
              <Button variant="ghost" onClick={onCancel} className="h-11 flex-1 rounded-none">
                Cancelar
              </Button>
              <Button
                type="submit"
                variant="primary"
                className="h-11 flex-1 rounded-none border-l border-wa-border dark:border-wa-border-dark"
              >
                Mover a Perdido
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
