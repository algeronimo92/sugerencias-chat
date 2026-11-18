import { FilePlus2, Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Input, Textarea, labelClass } from '../../../shared/ui/Input'
import { Modal } from '../../../shared/ui/Modal'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useCreateTemplate } from '../hooks/useTemplates'
import type { MessageTemplate } from '../types'
import { TemplateVariableChips } from './TemplateVariableChips'

interface Props {
  onClose: () => void
  onCreated: (template: MessageTemplate) => void
}

/**
 * Crear una plantilla interna mínima (nombre + contenido) sin salir del
 * constructor de flujos. Si después hace falta agregarle adjuntos o volverla
 * interactiva, se edita desde la pantalla de Plantillas como cualquier otra.
 */
export function CreateTemplateDialog({ onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [content, setContent] = useState('')
  const [error, setError] = useState<string | null>(null)
  const contentField = useRef<HTMLTextAreaElement>(null)
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
        official_header_type: 'none',
        official_header_text: null,
        official_header_media_asset_id: null,
        official_footer: null,
        official_buttons: [],
        interactive_type: 'none',
        interactive_config: {},
      },
      {
        onSuccess: (template) => onCreated(template),
        onError: (reason) => setError(extractErrorMessage(reason)),
      },
    )
  }

  const pending = createTemplate.isPending
  return (
    <Modal
      title="Nueva plantilla"
      description="Un mensaje de texto para reutilizar en tus flujos."
      icon={<FilePlus2 className="h-4 w-4" />}
      busy={pending}
      onClose={onClose}
      footer={<>
        <Button variant="ghost" onClick={onClose} disabled={pending}>Cancelar</Button>
        <Button onClick={submit} disabled={pending}>{pending && <Loader2 className="h-4 w-4 animate-spin" />}Crear plantilla</Button>
      </>}
    >
      <form className="space-y-4" onSubmit={event => { event.preventDefault(); submit() }}>
        <div>
          <label htmlFor="create-template-name" className={labelClass}>Nombre</label>
          <Input id="create-template-name" value={name} maxLength={120} autoFocus onChange={event => setName(event.target.value)} placeholder="Ej. Bienvenida" />
        </div>
        <div className="space-y-2">
          <label htmlFor="create-template-content" className={labelClass}>Mensaje</label>
          <Textarea id="create-template-content" ref={contentField} rows={5} value={content} onChange={event => setContent(event.target.value)} placeholder="Hola {{nombre}}, ..." className="resize-y leading-relaxed" />
          <TemplateVariableChips field={contentField} value={content} onChange={setContent} />
        </div>
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
      </form>
    </Modal>
  )
}
