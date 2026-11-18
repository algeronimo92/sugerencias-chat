import { FileJson, Loader2, TriangleAlert, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Input, Textarea, labelClass } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { extractErrorMessage } from '../../../shared/utils/errors'
import type { AutomationFlowDefinition } from '../types'

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
    <Modal
      title={title}
      description={description}
      icon={<FileJson className="h-4 w-4" />}
      size="md"
      busy={isSubmitting}
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={isSubmitting}>Cancelar</Button>
        <Button variant={destructiveNotice ? 'danger' : 'primary'} onClick={() => void submit()} disabled={isSubmitting || !text.trim()}>
          {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}{confirmLabel}
        </Button>
      </>}
    >
      <div className="space-y-4">
        {destructiveNotice && (
          <div className="flex gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>{destructiveNotice}</span>
          </div>
        )}
        {requireNameField && (
          <div>
            <label htmlFor="import-flow-name" className={labelClass}>Nombre del flujo</label>
            <Input id="import-flow-name" value={name} maxLength={120} onChange={event => setName(event.target.value)} placeholder="Ej. Bienvenida a leads nuevos" />
          </div>
        )}
        <div>
          <div className="mb-1 flex items-center justify-between gap-2">
            <label htmlFor="import-flow-json" className="block text-xs font-medium text-wa-muted dark:text-wa-muted-dark">JSON del flujo</label>
            <Button variant="ghost" size="sm" onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-3.5 w-3.5" />Subir archivo .json
            </Button>
            <input ref={fileInputRef} type="file" accept=".json,application/json" className="hidden" onChange={handleFileChange} />
          </div>
          <Textarea
            id="import-flow-json"
            rows={12}
            value={text}
            onChange={event => { setText(event.target.value); setError(null) }}
            placeholder='{"conditions": {}, "nodes": [...], "edges": [...]}'
            spellCheck={false}
            className="resize-y font-mono text-xs leading-relaxed"
          />
        </div>
        {error && <p role="alert" className="whitespace-pre-line text-sm text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Modal>
  )
}
