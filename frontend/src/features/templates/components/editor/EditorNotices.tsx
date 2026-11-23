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

/** El cupo de Meta para cambiar el mensaje de una plantilla aprobada. */
const EDIT_CAP = 'Meta permite cambiar el mensaje de una aprobada una vez cada 24 horas y diez veces cada 30 días.'
const FREE_FIELDS = 'El nombre, la categoría del equipo y el atajo se cambian sin revisión.'

interface MetaNotice {
  tone: 'warning' | 'danger'
  title: string
  body: string
}

/**
 * Qué implica tocar una plantilla que Meta ya tiene, según su estado. Las
 * reglas (qué se puede editar, cuántas veces) son las de `metaEditRules`:
 * acá se le dicen al usuario antes de que choque con ellas al guardar.
 */
function metaNotice(editor: TemplateEditorState, template: MessageTemplate | undefined, status: OfficialStatus | null): MetaNotice | null {
  switch (status?.kind) {
    case 'rejected':
      return {
        tone: 'danger',
        title: 'Meta la rechazó',
        body: `${rejectedReason(template?.official_rejected_reason) ?? 'Meta no informó el motivo'}. Corrígela y vuelve a enviarla: una rechazada se puede reenviar las veces que haga falta.`,
      }
    case 'review':
      return {
        tone: 'warning',
        title: 'Meta la está revisando',
        body: `Hasta que responda no acepta cambios en el mensaje ni en el tipo. ${FREE_FIELDS}`,
      }
    case 'disabled':
      return {
        tone: 'danger',
        title: 'Meta la deshabilitó',
        body: 'Ya no se puede enviar ni corregir. Para seguir usándola, duplícala desde la lista y envía la copia a revisión.',
      }
    case 'paused':
      return {
        tone: 'warning',
        title: 'Meta la pausó',
        body: 'Por ahora no se puede enviar. Puedes corregir el mensaje; al guardarlo, Meta la vuelve a revisar.',
      }
    case 'approved':
      return editor.goesBackToReview
        ? { tone: 'warning', title: 'Al guardar, Meta vuelve a revisarla', body: `Hasta que la apruebe no se podrá enviar, ni desde el chat ni desde las automatizaciones. ${EDIT_CAP}` }
        : { tone: 'warning', title: 'Esta plantilla está aprobada', body: `Si cambias el mensaje, los datos, el encabezado, el pie o los botones, vuelve a revisión y no se podrá enviar hasta que Meta responda. ${EDIT_CAP} ${FREE_FIELDS}` }
    default:
      return null
  }
}

function MetaReviewNotice({ editor, template, status }: { editor: TemplateEditorState; template: MessageTemplate | undefined; status: OfficialStatus | null }) {
  const notice = editor.metaLocked ? metaNotice(editor, template, status) : null
  if (!notice) return null
  return (
    <Notice tone={notice.tone}>
      <p className="font-semibold">{notice.title}</p>
      <p>{notice.body}</p>
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
