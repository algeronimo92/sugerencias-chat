import { useRef, useState } from 'react'
import { Loader2, Upload, X } from 'lucide-react'
import type { AutomationFlowDefinition } from '../types'
import { extractErrorMessage } from '../utils/errors'
import { DialogPrimitive as Dialog, dialogContentPositionClassElevated, dialogOverlayClassElevated } from './ui/Dialog'

const fieldClass = 'w-full rounded-lg border border-wa-border bg-white px-2.5 py-2 text-xs text-wa-text outline-none focus:border-wa-primary focus:ring-2 focus:ring-wa-primary/20 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark'

interface ImportFlowJsonDialogProps {
  title: string
  description: string
  confirmLabel: string
  requireNameField?: boolean
  destructiveNotice?: string
  onClose: () => void
  onImport: (flowDefinition: AutomationFlowDefinition, name: string) => Promise<void>
}

/** Diálogo reutilizable para pegar o subir un archivo .json con un
 *  flow_definition. Valida solo que el texto sea JSON parseable; el resto
 *  (nodos, edges, tipos de acción) lo valida el backend y su mensaje se
 *  muestra tal cual si falla. */
export function ImportFlowJsonDialog({
  title,
  description,
  confirmLabel,
  requireNameField = false,
  destructiveNotice,
  onClose,
  onImport,
}: ImportFlowJsonDialogProps) {
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => { setText(String(reader.result ?? '')); setError(null) }
    reader.onerror = () => setError('No se pudo leer el archivo.')
    reader.readAsText(file)
  }

  async function submit() {
    setError(null)
    if (requireNameField && !name.trim()) {
      setError('Escribe un nombre para el flujo.')
      return
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (reason) {
      setError(`JSON inválido: ${reason instanceof Error ? reason.message : String(reason)}`)
      return
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      setError('JSON inválido: se esperaba un objeto con "nodes" y "edges".')
      return
    }
    setIsSubmitting(true)
    try {
      await onImport(parsed as AutomationFlowDefinition, name.trim())
      onClose()
    } catch (reason) {
      setError(extractErrorMessage(reason))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !isSubmitting) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClassElevated} />
        <Dialog.Content
          onEscapeKeyDown={event => { if (isSubmitting) event.preventDefault() }}
          onPointerDownOutside={event => { if (isSubmitting) event.preventDefault() }}
          className={`${dialogContentPositionClassElevated} flex max-h-[88vh] w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden rounded-xl border border-wa-border bg-white shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}
        >
          <div className="flex items-center justify-between border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
            <Dialog.Title className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">{title}</Dialog.Title>
            <button type="button" onClick={onClose} disabled={isSubmitting} aria-label="Cerrar" className="text-wa-muted transition-colors hover:text-gray-600 disabled:opacity-40 dark:hover:text-gray-300">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
            <Dialog.Description className="text-xs leading-relaxed text-wa-muted">{description}</Dialog.Description>
            {destructiveNotice && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                {destructiveNotice}
              </div>
            )}
            {requireNameField && (
              <label className="grid gap-1 text-[10px] text-wa-muted">Nombre del flujo
                <input value={name} maxLength={120} onChange={event => setName(event.target.value)} placeholder="Ej. Bienvenida a leads nuevos" className={fieldClass} />
              </label>
            )}
            <div className="flex items-center justify-between">
              <label className="text-[10px] font-semibold uppercase tracking-wide text-wa-muted">JSON del flujo</label>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-1 text-[11px] font-semibold text-wa-primary-strong hover:underline dark:text-wa-primary"
              >
                <Upload className="h-3.5 w-3.5" />Subir archivo .json
              </button>
              <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFileChange} />
            </div>
            <textarea
              rows={12}
              value={text}
              onChange={event => { setText(event.target.value); setError(null) }}
              placeholder='{"conditions": {}, "nodes": [...], "edges": [...]}'
              spellCheck={false}
              className={`${fieldClass} font-mono`}
            />
            {error && <p className="whitespace-pre-line text-[11px] text-red-600">{error}</p>}
          </div>

          <div className="flex border-t border-wa-border dark:border-wa-border-dark">
            <button type="button" onClick={onClose} disabled={isSubmitting} className="flex-1 py-2.5 text-sm font-medium text-gray-600 transition-colors hover:bg-wa-hover disabled:opacity-40 dark:text-gray-300 dark:hover:bg-wa-head-dark">
              Cancelar
            </button>
            <button
              type="button"
              onClick={() => void submit()}
              disabled={isSubmitting || !text.trim()}
              className="flex flex-1 items-center justify-center gap-1.5 border-l border-wa-border py-2.5 text-sm font-medium text-white transition-colors bg-wa-primary hover:bg-wa-primary-strong disabled:opacity-50 dark:border-wa-border-dark"
            >
              {isSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {confirmLabel}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
