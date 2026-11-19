import { ListChecks } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { Modal } from '../../../shared/ui/Modal'
import { extractErrorMessage } from '../../../shared/utils/errors'
import {
  contactsLabel, importResultDetail, initialSelection, selectionCount, toSelection, type SelectionDraft,
} from '../domain/selection'
import { useConfirmImport, useDiscardImport, useImportSummary } from '../hooks/useContacts'
import { ImportSelectionFields } from './ImportSelectionFields'

interface Props {
  batchId: string
  onClose: () => void
}

/** Paso 2 de toda importación: cuántos contactos pasan a la agenda.
 *  Se puede importar una parte, volver más tarde por otra y descartar el resto. */
export function ImportReviewDialog({ batchId, onClose }: Props) {
  const { data: summary, isLoading } = useImportSummary(batchId)
  const confirm = useConfirmImport()
  const discard = useDiscardImport()
  const [draft, setDraft] = useState<SelectionDraft | null>(null)
  const busy = confirm.isPending || discard.isPending

  useEffect(() => {
    if (summary && draft === null) setDraft(initialSelection(summary))
  }, [summary, draft])

  const patch = (values: Partial<SelectionDraft>) => setDraft(current => (current ? { ...current, ...values } : current))
  const total = summary && draft ? selectionCount(summary, draft) : 0
  const fromPhone = summary?.source === 'whatsapp_app'

  function submit() {
    if (!draft) return
    confirm.mutate({ batchId, ...toSelection(draft) }, {
      onSuccess: result => {
        toast.success(`${contactsLabel(result.created)} agregados a la agenda`, { description: importResultDetail(result) })
        onClose()
      },
      onError: err => toast.error('No se pudo importar', { description: extractErrorMessage(err) }),
    })
  }

  function discardRest() {
    discard.mutate(batchId, {
      onSuccess: () => { toast.success('Importación descartada'); onClose() },
      onError: err => toast.error('No se pudo descartar', { description: extractErrorMessage(err) }),
    })
  }

  return (
    <Modal
      title={fromPhone ? 'Contactos del celular' : `Importar ${summary?.file_name ?? 'CSV'}`}
      description="Elige cuántos pasan a la agenda. Lo que no elijas sigue esperando aquí."
      icon={<ListChecks className="h-5 w-5" aria-hidden="true" />}
      size="lg"
      layer="confirm"
      busy={busy}
      onClose={onClose}
      footer={(
        <>
          <Button variant="ghost" onClick={discardRest} disabled={busy || !summary || summary.status !== 'open'} className="mr-auto">
            Descartar todo lo pendiente
          </Button>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Más tarde</Button>
          <Button onClick={submit} disabled={busy || !draft || total === 0 || summary?.status !== 'open'}>
            {confirm.isPending ? 'Importando…' : `Importar ${contactsLabel(total)}`}
          </Button>
        </>
      )}
    >
      {(isLoading || !summary || !draft) ? (
        <p className="text-sm text-wa-muted dark:text-wa-muted-dark">Cargando…</p>
      ) : (
        <ImportSelectionFields batchId={batchId} summary={summary} draft={draft} patch={patch} />
      )}
    </Modal>
  )
}
