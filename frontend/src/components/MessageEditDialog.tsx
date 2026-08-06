import { useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import type { Message } from '../types'
import { useEditMessage } from '../hooks/useMessages'
import { extractErrorMessage } from '../utils/errors'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './ui/Dialog'

/** Reescribe el texto de un mensaje ya enviado.
 *
 * Va en un diálogo y no dentro de la burbuja: el texto original queda a la
 * vista en el hilo mientras se corrige, y el textarea tiene el ancho que la
 * burbuja no tiene. Enter manda (como el compositor), Shift+Enter hace salto
 * de línea. */
export function MessageEditDialog({ chatId, message, onClose }: {
  chatId: string
  message: Message
  onClose: () => void
}) {
  const [text, setText] = useState(message.content ?? '')
  const edit = useEditMessage(chatId)
  const trimmed = text.trim()
  const unchanged = trimmed === (message.content ?? '').trim()

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!trimmed || unchanged || edit.isPending) return
    edit.mutate({ messageId: message.id, text: trimmed }, {
      onSuccess: () => { toast.success('Mensaje editado'); onClose() },
      onError: error => toast.error(extractErrorMessage(error)),
    })
  }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !edit.isPending) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content
          asChild
          onEscapeKeyDown={event => { if (edit.isPending) event.preventDefault() }}
          onPointerDownOutside={event => { if (edit.isPending) event.preventDefault() }}
          className={`${dialogContentPositionClass} w-[calc(100%-2rem)] max-w-md rounded-xl border border-wa-border bg-white shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}
        >
          <form onSubmit={submit}>
            <div className="flex items-center justify-between border-b px-4 py-3 dark:border-wa-border-dark">
              <Dialog.Title className="text-sm font-semibold dark:text-white">Editar mensaje</Dialog.Title>
              <button type="button" onClick={onClose} aria-label="Cerrar">
                <X className="h-4 w-4 text-wa-muted" />
              </button>
            </div>
            <div className="space-y-2 p-4">
              <textarea
                autoFocus
                rows={4}
                maxLength={4096}
                value={text}
                onChange={event => setText(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(event) }
                }}
                className="w-full resize-y rounded-lg border border-wa-border px-3 py-2 text-sm text-wa-text outline-none focus:ring-2 focus:ring-wa-primary/50 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark"
              />
              <p className="text-[11px] text-wa-muted dark:text-wa-muted-dark">
                El cliente verá el texto corregido con la marca "Editado". WhatsApp solo lo
                permite dentro de los 15 minutos posteriores al envío.
              </p>
            </div>
            <div className="flex justify-end gap-2 border-t px-4 py-3 dark:border-wa-border-dark">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-wa-muted">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={!trimmed || unchanged || edit.isPending}
                className="flex items-center gap-2 rounded-lg bg-wa-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {edit.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar
              </button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
