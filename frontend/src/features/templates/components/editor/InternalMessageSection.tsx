import { Info } from 'lucide-react'
import { CAPTION_MAX_LENGTH } from '../../domain/attachmentDraft'
import { contentLimit, fieldId } from '../../domain/fieldLimits'
import { internalVariablesIn } from '../../domain/templatePreview'
import type { TemplateEditorState } from '../../hooks/useTemplateEditor'
import type { InteractiveLimits, TemplateInteractiveType } from '../../types'
import { TemplateAttachmentsEditor } from '../TemplateAttachmentsEditor'
import { TemplateVariableChips } from '../TemplateVariableChips'
import { InteractiveOptionsEditor } from './InteractiveOptionsEditor'
import { MessageField } from './MessageField'
import { ChoicePill, EditorSection } from './parts'

const FORMATS: { value: TemplateInteractiveType; title: string }[] = [
  { value: 'none', title: 'Texto y archivos' },
  { value: 'button', title: 'Con botones de respuesta' },
  { value: 'list', title: 'Con lista de opciones' },
]

function joinLabels(labels: string[]): string {
  const lower = labels.map(label => label.toLowerCase())
  return lower.length > 1 ? `${lower.slice(0, -1).join(', ')} o ${lower.at(-1)}` : lower[0]
}

interface Props {
  editor: TemplateEditorState
  limits: InteractiveLimits | undefined
  defaultFooter: string | undefined
  /** Cambiar de formato puede quitar archivos: lo decide quien arma la página. */
  onFormatChange: (format: TemplateInteractiveType) => void
}

/** El mensaje de una plantilla interna: formato, texto y lo que lo acompaña
 *  (archivos, o botones y listas). */
export function InternalMessageSection({ editor, limits, defaultFooter, onFormatChange }: Props) {
  const { form, change, errorsFor, attachments, setAttachments, carriesAttachments, setServerError, saving } = editor
  const max = contentLimit(form, limits)
  const variables = internalVariablesIn(form.content)
  const textGoesApart = carriesAttachments && attachments.length > 0 && form.content.trim().length > CAPTION_MAX_LENGTH

  return (
    <EditorSection title="Mensaje">
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-fg">Formato</legend>
        <div className="flex flex-wrap gap-2">
          {FORMATS.map(format => (
            <ChoicePill key={format.value} name="internal-format" title={format.title} checked={form.interactiveType === format.value} onSelect={() => onFormatChange(format.value)} />
          ))}
        </div>
      </fieldset>

      <MessageField
        id={fieldId('content')}
        label="Texto del mensaje"
        value={form.content}
        max={max}
        placeholder="Hola {{nombre}}, …"
        errors={errorsFor('content')}
        onChange={content => change({ content })}
        insertTools={field => (
          <TemplateVariableChips
            field={field}
            value={form.content}
            onChange={content => { if (max === undefined || content.length <= max) change({ content }) }}
          />
        )}
        hint={<>
          {variables.length > 0 && (
            <p className="flex items-start gap-1.5 text-sm text-fg-muted">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              Si al lead le falta {joinLabels(variables)}, ese hueco sale vacío. Mira cómo queda con «Sin datos» en la vista previa.
            </p>
          )}
          {textGoesApart && (
            <p className="flex items-start gap-1.5 text-sm text-warning-fg">
              <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              El texto pasa de {CAPTION_MAX_LENGTH} caracteres: se enviará como mensaje aparte, no como pie del archivo.
            </p>
          )}
        </>}
      />

      {carriesAttachments
        ? <TemplateAttachmentsEditor items={attachments} onChange={setAttachments} text={form.content} onError={setServerError} disabled={saving} />
        : <InteractiveOptionsEditor editor={editor} limits={limits} defaultFooter={defaultFooter} />}
    </EditorSection>
  )
}
