import { FileSpreadsheet, Plus, RotateCcw, Users } from 'lucide-react'
import { useState, type ComponentType } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useMe } from '../../auth/public/queries'
import { can, useCan } from '../../../shared/permissions'
import { CONTACTS_PAGE_SIZE } from '../api'
import { EMPTY_FILTERS, hasActiveFilters } from '../domain/filters'
import { contactsLabel } from '../domain/selection'
import { useContacts, usePromoteContact } from '../hooks/useContacts'
import { useSelection } from '../hooks/useSelection'
import type { Contact, ContactFilters } from '../types'
import { ContactFormDialog } from './ContactFormDialog'
import { ContactList, ContactListSkeleton } from './ContactList'
import { ContactsBulkBar } from './ContactsBulkBar'
import { ContactsFilterBar } from './ContactsFilterBar'
import { CsvImportDialog } from './CsvImportDialog'
import { InitialFilter } from './InitialFilter'
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
    return <ContactListSkeleton />
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

/** El panel de "Separar cita". Lo pone `app/`: citas es una capa superior a
 *  contactos y esta feature no puede importarla. */
export type ContactAppointmentPanel = ComponentType<{
  leadId: string
  name: string | null
  phone: string | null
  onClose: () => void
}>

interface Props {
  onOpenChat: (leadId: string) => void
  AppointmentPanel?: ContactAppointmentPanel
}

/** Un solo diálogo abierto a la vez: antes eran cinco estados sueltos. */
type Dialog =
  | { kind: 'new' }
  | { kind: 'edit'; contact: Contact }
  | { kind: 'import' }
  | { kind: 'review'; batchId: string }
  | { kind: 'schedule'; contact: Contact }

function ContactsDialogs({ dialog, onChange, AppointmentPanel }: {
  dialog: Dialog | null; onChange: (dialog: Dialog | null) => void; AppointmentPanel?: ContactAppointmentPanel
}) {
  const close = () => onChange(null)
  switch (dialog?.kind) {
    case 'new':
      return <ContactFormDialog contact={null} onClose={close} />
    case 'edit':
      return <ContactFormDialog contact={dialog.contact} onClose={close} />
    case 'import':
      return <CsvImportDialog onClose={close} onCreated={batchId => onChange({ kind: 'review', batchId })} />
    case 'review':
      return <ImportReviewDialog batchId={dialog.batchId} onClose={close} />
    case 'schedule': {
      const { lead_id, nombre, telefono } = dialog.contact
      if (!lead_id || !AppointmentPanel) return null
      return <AppointmentPanel leadId={lead_id} name={nombre} phone={telefono} onClose={close} />
    }
    default:
      return null
  }
}

function ContactsHeader({ canImport, onImport, onNew }: { canImport: boolean; onImport: () => void; onNew: () => void }) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-fg">Contactos</h1>
        <p className="mt-1.5 hidden max-w-prose text-sm leading-6 text-fg-muted sm:block">
          Tu agenda completa. Importa desde el celular o un CSV y pasa a lead a quien quieras atender.
        </p>
      </div>
      <div className="flex gap-2">
        {canImport && (
          <Button variant="secondary" onClick={onImport}>
            <FileSpreadsheet className="h-4 w-4" aria-hidden="true" />
            Importar CSV
          </Button>
        )}
        <Button onClick={onNew}>
          <Plus className="h-4 w-4" aria-hidden="true" />
          Nuevo contacto
        </Button>
      </div>
    </header>
  )
}

function ResultsSummary({ filters, page, onClear }: { filters: ContactFilters; page: number; onClear: () => void }) {
  // La misma consulta que ContactsResults (React Query la comparte): solo el total.
  const { data, isLoading, isError } = useContacts(filters, page)
  let label = contactsLabel(data?.total ?? 0)
  if (isLoading) label = 'Cargando contactos…'
  else if (isError) label = 'Listado no disponible'
  return (
    <div className="mb-3 mt-5 flex items-center justify-between gap-2">
      <p aria-live="polite" className="text-sm text-fg-muted">{label}</p>
      {hasActiveFilters(filters) && (
        <Button variant="ghost" size="sm" className="h-9" onClick={onClear}>
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          Quitar filtros
        </Button>
      )}
    </div>
  )
}

function ContactsPager({ filters, page, onChange }: { filters: ContactFilters; page: number; onChange: (page: number) => void }) {
  const { data } = useContacts(filters, page)
  const pages = Math.max(1, Math.ceil((data?.total ?? 0) / CONTACTS_PAGE_SIZE))
  return <Pager page={page} pages={pages} onChange={onChange} className="mt-3" />
}

/** Lo que la tarjeta puede hacer, según los permisos de quien mira. */
function useListProps({ filters, page, selection, onOpenChat, openDialog, canSchedule }: {
  filters: ContactFilters
  page: number
  selection: ReturnType<typeof useSelection>
  onOpenChat: (leadId: string) => void
  openDialog: (dialog: Dialog) => void
  canSchedule: boolean
}): ListProps {
  const allowed = useCan()
  const { data } = useContacts(filters, page)
  const promote = usePromoteContact()

  function promoteOne(contact: Contact) {
    promote.mutate(contact.id, {
      onSuccess: ({ lead_id }) => toast.success('Ahora es un lead', {
        action: { label: 'Abrir chat', onClick: () => onOpenChat(lead_id) },
      }),
      onError: err => toast.error('No se pudo pasar a lead', { description: extractErrorMessage(err) }),
    })
  }

  return {
    selected: selection.selected,
    onToggle: selection.toggle,
    onToggleAll: () => selection.togglePage((data?.items ?? []).map(contact => contact.id)),
    onEdit: allowed('contacts.edit') ? contact => openDialog({ kind: 'edit', contact }) : undefined,
    onSchedule: canSchedule && allowed('appointments.edit') ? contact => openDialog({ kind: 'schedule', contact }) : undefined,
    onOpenChat,
    onPromote: promoteOne,
    promotingId: promote.isPending ? (promote.variables ?? null) : null,
  }
}

/** La agenda del negocio: todos, hayan escrito o no. Un lead es un contacto
 *  que entró al embudo; desde acá se pasa con un clic. */
export function ContactsPage({ onOpenChat, AppointmentPanel }: Props) {
  const { data: me } = useMe()
  const isAdmin = can(me, 'contacts.import')
  const [filters, setFilters] = useState<ContactFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const selection = useSelection()
  const listProps = useListProps({
    filters, page, selection, onOpenChat, openDialog: setDialog, canSchedule: Boolean(AppointmentPanel),
  })

  function patch(values: Partial<ContactFilters>) {
    setFilters(current => ({ ...current, ...values }))
    setPage(0)
    selection.clear()
  }

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto bg-canvas">
      {/* 1280 y no 1200: deja ~270 px por tarjeta en la cuadrícula de 4. */}
      <main className="mx-auto w-full max-w-[1280px] px-4 py-4 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
        <ContactsHeader
          canImport={isAdmin}
          onImport={() => setDialog({ kind: 'import' })}
          onNew={() => setDialog({ kind: 'new' })}
        />
        {isAdmin && <PendingImports onReview={batchId => setDialog({ kind: 'review', batchId })} />}
        <ContactsFilterBar filters={filters} onChange={patch} />
        <InitialFilter value={filters.initial} onChange={initial => patch({ initial })} />
        <ResultsSummary filters={filters} page={page} onClear={() => patch(EMPTY_FILTERS)} />
        <ContactsResults filters={filters} page={page} isFiltered={hasActiveFilters(filters)} listProps={listProps} />
        <ContactsPager filters={filters} page={page} onChange={setPage} />
        {selection.selected.size > 0 && (
          <ContactsBulkBar ids={[...selection.selected]} isAdmin={can(me, 'contacts.import', 'contacts.delete')} onDone={selection.clear} />
        )}
      </main>
      <ContactsDialogs dialog={dialog} onChange={setDialog} AppointmentPanel={AppointmentPanel} />
    </div>
  )
}
