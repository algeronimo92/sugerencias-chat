import { Button } from '../../../../shared/ui/Button'
import { elapsedLabel } from '../../domain/templateDraftStorage'
import { rejectedReason, type OfficialStatus } from '../../domain/templateList'
import type { TemplateEditorState } from '../../hooks/useTemplateEditor'
import type { MessageTemplate, TemplateCapabilities } from '../../types'
import { Notice } from './parts'

/** Se recuperó un borrador que había quedado sin guardar. */
function RestoredNotice({ editor }: { editor: TemplateEditorState }) {
  if (editor.restoredAt == null) return null
  return (
    <Notice
      tone="accent"
      action={<div className="flex gap-2">
        <Button variant="secondary" size="sm" onClick={editor.discardChanges}>Descartar</Button>
        <Button variant="ghost" size="sm" onClick={editor.dismissRestored}>Entendido</Button>
      </div>}
    >
      <p><strong className="font-semibold">Recuperamos lo que habías escrito</strong> {elapsedLabel(editor.restoredAt)}. Los archivos que hubieras elegido no entran en el respaldo: vuelve a agregarlos.</p>
    </Notice>
  )
}

/** Qué implica tocar una plantilla que Meta ya tiene: rechazada, o que
 *  vuelve a revisión si cambia lo que Meta mira. */
function MetaReviewNotice({ editor, template, status }: { editor: TemplateEditorState; template: MessageTemplate | undefined; status: OfficialStatus | null }) {
  if (status?.kind === 'rejected') {
    return (
      <Notice tone="danger">
        <p className="font-semibold">Meta la rechazó</p>
        <p>{rejectedReason(template?.official_rejected_reason) ?? 'Meta no informó el motivo'}. Corrígela y vuelve a enviarla.</p>
      </Notice>
    )
  }
  if (!editor.metaLocked) return null
  return (
    <Notice tone="warning">
      <p className="font-semibold">{editor.goesBackToReview ? 'Al guardar, Meta vuelve a revisarla' : 'Esta plantilla ya fue enviada a Meta'}</p>
      <p>{editor.goesBackToReview
        ? 'Hasta que la apruebe no se podrá enviar, ni desde el chat ni desde las automatizaciones.'
        : 'Si cambias el mensaje, los datos, el encabezado, el pie o los botones, vuelve a revisión. El nombre, la categoría del equipo y el atajo se cambian sin revisión.'}</p>
    </Notice>
  )
}

interface Props {
  editor: TemplateEditorState
  template: MessageTemplate | undefined
  status: OfficialStatus | null
  capabilities: TemplateCapabilities | undefined
}

/** Los avisos que encabezan el formulario, según el estado de la plantilla. */
export function EditorNotices({ editor, template, status, capabilities }: Props) {
  const official = editor.form.templateType === 'official'
  const disconnected = official && capabilities != null && !capabilities.official_sending_supported
  return (
    <>
      <RestoredNotice editor={editor} />
      {official && <MetaReviewNotice editor={editor} template={template} status={status} />}
      {disconnected && (
        <Notice tone="warning">
          <p className="font-semibold">WhatsApp no está conectado</p>
          <p>{capabilities.reason ?? 'Sin la conexión con Meta no se puede enviar la plantilla a revisión.'}</p>
        </Notice>
      )}
    </>
  )
}
