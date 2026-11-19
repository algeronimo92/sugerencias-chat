import { FileSpreadsheet, Plus, RotateCcw, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { Skeleton } from '../../../shared/ui/Skeleton'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useMe } from '../../auth/public/queries'
import { CONTACTS_PAGE_SIZE } from '../api'
import { EMPTY_FILTERS, hasActiveFilters } from '../domain/filters'
import { contactsLabel } from '../domain/selection'
import { useContacts, usePromoteContact } from '../hooks/useContacts'
import { useSelection } from '../hooks/useSelection'
import type { Contact, ContactFilters } from '../types'
import { ContactFormDialog } from './ContactFormDialog'
import { ContactList } from './ContactList'
import { ContactsBulkBar } from './ContactsBulkBar'
import { ContactsFilterBar } from './ContactsFilterBar'
import { CsvImportDialog } from './CsvImportDialog'
import { ImportReviewDialog } from './ImportReviewDialog'
import { Pager } from './Pager'
import { PendingImports } from './PendingImports'

type ListProps = Omit<Parameters<typeof ContactList>[0], 'contacts'>

/** Carga, error, vacío o la lista: un solo lugar decide qué se ve. */
function ContactsResults({ filters, page, isFiltered, listProps }: {
  filters: ContactFilters; page: number; isFiltered: boolean; listProps: ListProps
}) {
  const { data, isLoading, isError, error } = useContacts(filters, page)
  if (isLoading) {
    return <div className="space-y-2">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-16 w-full rounded-xl" />)}</div>
  }
  if (isError) return <EmptyState icon={Users} title="No se pudo cargar la agenda" description={extractErrorMessage(error)} />
  if (!data?.items.length) {
    return (
      <EmptyState
        icon={Users}
        title={isFiltered ? 'Ningún contacto coincide' : 'Todavía no hay contactos'}
        description={isFiltered ? 'Prueba con otro filtro.' : 'Agrega uno, importa un CSV o conecta la app WhatsApp Business del celular.'}
      />
    )
  }
  return <ContactList contacts={data.items} {...listProps} />
}

/** La agenda del negocio: todos, hayan escrito o no. Un lead es un contacto
 *  que entró al embudo; desde acá se pasa con un clic. */
export function ContactsPage({ onOpenChat }: { onOpenChat: (leadId: string) => void }) {
  const { data: me } = useMe()
  const isAdmin = me?.role === 'admin'
  const [filters, setFilters] = useState<ContactFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  const [editing, setEditing] = useState<Contact | null | 'new'>(null)
  const [importing, setImporting] = useState(false)
  const [reviewing, setReviewing] = useState<string | null>(null)
  const selection = useSelection()
  // La misma consulta que ContactsResults (React Query la comparte): solo el total.
  const { data, isLoading, isError } = useContacts(filters, page)
  const promote = usePromoteContact()
  const total = data?.total ?? 0
  const isFiltered = hasActiveFilters(filters)

  function patch(values: Partial<ContactFilters>) {
    setFilters(current => ({ ...current, ...values }))
    setPage(0)
    selection.clear()
  }

  function promoteOne(contact: Contact) {
    promote.mutate(contact.id, {
      onSuccess: ({ lead_id }) => toast.success('Ahora es un lead', {
        action: { label: 'Abrir chat', onClick: () => onOpenChat(lead_id) },
      }),
      onError: err => toast.error('No se pudo pasar a lead', { description: extractErrorMessage(err) }),
    })
  }

  const listProps: ListProps = {
    selected: selection.selected,
    onToggle: selection.toggle,
    onToggleAll: () => selection.togglePage((data?.items ?? []).map(contact => contact.id)),
    onEdit: setEditing,
    onOpenChat,
    onPromote: promoteOne,
    promotingId: promote.isPending ? (promote.variables ?? null) : null,
  }

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto bg-wa-app dark:bg-wa-app-dark">
      <main className="mx-auto w-full max-w-[1200px] px-4 py-4 pb-24 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-wa-text dark:text-white">Contactos</h1>
            <p className="mt-1.5 hidden max-w-prose text-sm leading-6 text-wa-muted sm:block dark:text-wa-muted-dark">
              Tu agenda completa. Importa desde el celular o un CSV y pasa a lead a quien quieras atender.
            </p>
          </div>
          <div className="flex gap-2">
            {isAdmin && (
              <Button variant="secondary" onClick={() => setImporting(true)}>
                <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
                Importar CSV
              </Button>
            )}
            <Button onClick={() => setEditing('new')}>
              <Plus className="h-4 w-4" aria-hidden="true" />
              Nuevo contacto
            </Button>
          </div>
        </header>

        {isAdmin && <PendingImports onReview={setReviewing} />}
        <ContactsFilterBar filters={filters} onChange={patch} />

        <div className="mb-3 mt-5 flex items-center justify-between gap-2">
          <p aria-live="polite" className="text-sm text-wa-muted dark:text-wa-muted-dark">
            {isLoading ? 'Cargando contactos…' : isError ? 'Listado no disponible' : contactsLabel(total)}
          </p>
          {isFiltered && (
            <Button variant="ghost" size="sm" className="h-9" onClick={() => patch(EMPTY_FILTERS)}>
              <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
              Quitar filtros
            </Button>
          )}
        </div>

        <ContactsResults filters={filters} page={page} isFiltered={isFiltered} listProps={listProps} />
        <Pager page={page} pages={Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE))} onChange={setPage} className="mt-3" />
      </main>

      {selection.selected.size > 0 && (
        <ContactsBulkBar ids={[...selection.selected]} isAdmin={isAdmin} onDone={selection.clear} />
      )}
      {editing !== null && <ContactFormDialog contact={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {importing && (
        <CsvImportDialog onClose={() => setImporting(false)} onCreated={batchId => { setImporting(false); setReviewing(batchId) }} />
      )}
      {reviewing && <ImportReviewDialog batchId={reviewing} onClose={() => setReviewing(null)} />}
    </div>
  )
}
