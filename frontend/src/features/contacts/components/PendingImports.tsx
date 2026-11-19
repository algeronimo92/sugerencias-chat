import { Button } from '../../../shared/ui/Button'
import { contactsLabel } from '../domain/selection'
import { useImports } from '../hooks/useContacts'
import { WhatsAppSyncCard } from './WhatsAppSyncCard'

/** Lo que espera revisión: lo que llegó del celular y los CSV a medio importar. */
export function PendingImports({ onReview }: { onReview: (batchId: string) => void }) {
  const { data: imports = [] } = useImports(true)
  const openCsv = imports.filter(item => item.source === 'csv' && item.status === 'open' && item.counts.pending > 0)
  return (
    <div className="mt-4 space-y-3 sm:mt-6">
      <WhatsAppSyncCard onReview={onReview} />
      {openCsv.map(item => (
        <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-wa-border bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:border-wa-border-dark dark:bg-wa-panel-dark">
          <p className="text-sm text-wa-text dark:text-wa-text-dark">
            <strong className="font-semibold">{item.file_name ?? 'CSV'}</strong>: {contactsLabel(item.counts.pending)} sin importar.
          </p>
          <Button size="sm" variant="secondary" onClick={() => onReview(item.id)}>Continuar importación</Button>
        </div>
      ))}
    </div>
  )
}
