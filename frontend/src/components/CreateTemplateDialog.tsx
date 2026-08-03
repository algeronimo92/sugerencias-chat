import { useState } from 'react'
import { Loader2, X } from 'lucide-react'
import type { MessageTemplate } from '../types'
import { useCreateTemplate } from '../hooks/useTemplates'
import { extractErrorMessage } from '../utils/errors'
import { DialogPrimitive as Dialog, dialogContentPositionClassElevated, dialogOverlayClassElevated } from './ui/Dialog'

interface Props {
  onClose: () => void
  onCreated: (template: MessageTemplate) => void
}

const fieldClass = 'w-full rounded-lg border border-wa-border bg-white px-2.5 py-2 text-xs text-wa-text outline-none focus:border-wa-primary focus:ring-2 focus:ring-wa-primary/20 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark'

/**
 * Crear una plantilla interna mínima (nombre + contenido) sin salir del
 * constructor de flujos. Si después hace falta agregarle adjuntos o volverla
 * interactiva, se edita desde la pantalla de Plantillas como cualquier otra.
 */
export function CreateTemplateDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const createTemplate = useCreateTemplate()

  function submit() {
    setError(null)
    const trimmedName = name.trim()
    const trimmedContent = content.trim()
    if (!trimmedName || !trimmedContent) {
      setError('Completa el nombre y el contenido.')
      return
    }
    createTemplate.mutate(
      {
        name: trimmedName,
        content: trimmedContent,
        shortcut: null,
        category: 'automatizacion',
        stage: null,
        task_type: null,
        service: null,
        template_type: 'internal',
        official_name: null,
        official_language: null,
        official_category: null,
        official_status: null,
        official_parameter_values: [],
        interactive_type: 'none',
        interactive_config: {},
      },
      {
        onSuccess: (template) => onCreated(template),
        onError: (reason) => setError(extractErrorMessage(reason)),
      },
    )
  }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !createTemplate.isPending) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClassElevated} />
        <Dialog.Content
          onEscapeKeyDown={event => { if (createTemplate.isPending) event.preventDefault() }}
          onPointerDownOutside={event => { if (createTemplate.isPending) event.preventDefault() }}
          className={`${dialogContentPositionClassElevated} w-[calc(100%-2rem)] max-w-sm rounded-xl border border-wa-border bg-white shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}
        >
          <div className="flex items-center justify-between border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
            <Dialog.Title className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Nueva plantilla</Dialog.Title>
            <button type="button" onClick={onClose} aria-label="Cerrar" className="text-wa-muted transition-colors hover:text-gray-600 dark:hover:text-gray-300">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="space-y-3 p-4">
            <label className="grid gap-1 text-[10px] text-wa-muted">Nombre
              <input value={name} maxLength={120} onChange={event => setName(event.target.value)} className={fieldClass} />
            </label>
            <label className="grid gap-1 text-[10px] text-wa-muted">Contenido
              <textarea rows={4} value={content} onChange={event => setContent(event.target.value)} placeholder="Hola {{nombre}}..." className={fieldClass} />
            </label>
            {error && <p className="text-[11px] text-red-600">{error}</p>}
          </div>

          <div className="flex border-t border-wa-border dark:border-wa-border-dark">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-wa-hover dark:text-gray-300 dark:hover:bg-wa-head-dark">
              Cancelar
            </button>
            <button
              type="button"
              onClick={submit}
              disabled={createTemplate.isPending}
              className="flex flex-1 items-center justify-center gap-1.5 border-l border-wa-border py-2.5 text-sm font-medium text-white transition-colors bg-wa-primary hover:bg-wa-primary-strong disabled:opacity-50 dark:border-wa-border-dark"
            >
              {createTemplate.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              Crear plantilla
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
