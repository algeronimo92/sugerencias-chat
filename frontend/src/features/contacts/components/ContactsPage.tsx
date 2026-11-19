import { ChevronLeft, ChevronRight, FileSpreadsheet, Plus, RotateCcw, Search, Users } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { EmptyState } from '../../../shared/ui/EmptyState'
import { Input, Select } from '../../../shared/ui/Input'
import { Skeleton } from '../../../shared/ui/Skeleton'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useMe } from '../../auth/public/queries'
import { CONTACTS_PAGE_SIZE } from '../api'
import { ORIGIN_LABELS, contactsLabel } from '../domain/selection'
import { useContactTags, useContacts, useImports, usePromoteContact } from '../hooks/useContacts'
import type { Contact, ContactFilters, ContactOrigin } from '../types'
import { ContactFormDialog } from './ContactFormDialog'
import { ContactList } from './ContactList'
import { ContactsBulkBar } from './ContactsBulkBar'
import { CsvImportDialog } from './CsvImportDialog'
import { ImportReviewDialog } from './ImportReviewDialog'
import { WhatsAppSyncCard } from './WhatsAppSyncCard'

const EMPTY_FILTERS: ContactFilters = { search: '', origen: '', tag: '', hasLead: '', consent: '', removedInApp: false }
// Sin borde: el fondo de campo ya los separa del panel.
const filterClass = 'h-10'

/** La agenda del negocio: todos, hayan escrito o no. Un lead es un contacto
 *  que entró al embudo; desde acá se pasa con un clic. */
export function ContactsPage({ onOpenChat }: { onOpenChat: (leadId: string) => void }) {
  const { data: me } = useMe()
  const isAdmin = me?.role === 'admin'
  const [filters, setFilters] = useState<ContactFilters>(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [editing, setEditing] = useState<Contact | null | 'new'>(null)
  const [importing, setImporting] = useState(false)
  const [reviewing, setReviewing] = useState<string | null>(null)

  const { data, isLoading, isError, error } = useContacts(filters, page)
  const { data: tags = [] } = useContactTags()
  const { data: imports = [] } = useImports(isAdmin)
  const promote = usePromoteContact()
  const contacts = data?.items ?? []
  const total = data?.total ?? 0
  const pages = Math.max(1, Math.ceil(total / CONTACTS_PAGE_SIZE))
  const isFiltered = JSON.stringify(filters) !== JSON.stringify(EMPTY_FILTERS)
  const openCsvImports = imports.filter(item => item.source === 'csv' && item.status === 'open' && item.counts.pending > 0)

  function patch(values: Partial<ContactFilters>) {
    setFilters(current => ({ ...current, ...values }))
    setPage(0)
    setSelected(new Set())
  }

  function toggle(id: string) {
    setSelected(current => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function toggleAll() {
    setSelected(current => {
      const everyone = contacts.every(contact => current.has(contact.id))
      const next = new Set(current)
      for (const contact of contacts) {
        if (everyone) next.delete(contact.id)
        else next.add(contact.id)
      }
      return next
    })
  }

  function promoteOne(contact: Contact) {
    promote.mutate(contact.id, {
      onSuccess: ({ lead_id }) => toast.success('Ahora es un lead', {
        action: { label: 'Abrir chat', onClick: () => onOpenChat(lead_id) },
      }),
      onError: err => toast.error('No se pudo pasar a lead', { description: extractErrorMessage(err) }),
    })
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

        {isAdmin && (
          <div className="mt-4 space-y-3 sm:mt-6">
            <WhatsAppSyncCard onReview={setReviewing} />
            {openCsvImports.map(item => (
              <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-wa-border bg-white p-3 sm:flex-row sm:items-center sm:justify-between dark:border-wa-border-dark dark:bg-wa-panel-dark">
                <p className="text-sm text-wa-text dark:text-wa-text-dark">
                  <strong className="font-semibold">{item.file_name ?? 'CSV'}</strong>: {contactsLabel(item.counts.pending)} sin importar.
                </p>
                <Button size="sm" variant="secondary" onClick={() => setReviewing(item.id)}>Continuar importación</Button>
              </div>
            ))}
          </div>
        )}

        <section aria-label="Filtros de contactos" className="mt-4 grid gap-2 rounded-xl border border-wa-border bg-white p-3 sm:mt-6 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr_1fr] dark:border-wa-border-dark dark:bg-wa-panel-dark">
          <span className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
            <Input type="search" value={filters.search} onChange={event => patch({ search: event.target.value })} placeholder="Nombre, número o correo" aria-label="Buscar contacto" className={`${filterClass} pl-9`} />
          </span>
          <Select value={filters.origen} onChange={event => patch({ origen: event.target.value as ContactOrigin | '' })} aria-label="Origen" className={filterClass}>
            <option value="">Cualquier origen</option>
            {(Object.keys(ORIGIN_LABELS) as ContactOrigin[]).map(origin => <option key={origin} value={origin}>{ORIGIN_LABELS[origin]}</option>)}
          </Select>
          <Select value={filters.tag} onChange={event => patch({ tag: event.target.value })} aria-label="Etiqueta" className={filterClass}>
            <option value="">Cualquier etiqueta</option>
            {tags.map(tag => <option key={tag} value={tag}>{tag}</option>)}
          </Select>
          <Select value={filters.hasLead} onChange={event => patch({ hasLead: event.target.value as ContactFilters['hasLead'] })} aria-label="Lead" className={filterClass}>
            <option value="">Con o sin lead</option>
            <option value="yes">Ya es lead</option>
            <option value="no">Todavía no es lead</option>
          </Select>
          <Select value={filters.consent} onChange={event => patch({ consent: event.target.value as ContactFilters['consent'] })} aria-label="Publicidad" className={filterClass}>
            <option value="">Publicidad: todos</option>
            <option value="yes">Aceptan publicidad</option>
            <option value="no">Sin permiso</option>
          </Select>
        </section>

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

        {isLoading ? (
          <div className="space-y-2">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-16 w-full rounded-xl" />)}</div>
        ) : isError ? (
          <EmptyState icon={Users} title="No se pudo cargar la agenda" description={extractErrorMessage(error)} />
        ) : contacts.length === 0 ? (
          <EmptyState
            icon={Users}
            title={isFiltered ? 'Ningún contacto coincide' : 'Todavía no hay contactos'}
            description={isFiltered ? 'Prueba con otro filtro.' : 'Agrega uno, importa un CSV o conecta la app WhatsApp Business del celular.'}
          />
        ) : (
          <ContactList
            contacts={contacts}
            selected={selected}
            onToggle={toggle}
            onToggleAll={toggleAll}
            onEdit={setEditing}
            onOpenChat={onOpenChat}
            onPromote={promoteOne}
            promotingId={promote.isPending ? (promote.variables ?? null) : null}
          />
        )}

        {pages > 1 && (
          <nav aria-label="Páginas" className="mt-3 flex items-center justify-center gap-3 text-sm text-wa-muted dark:text-wa-muted-dark">
            <Button variant="ghost" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)} aria-label="Página anterior">
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </Button>
            <span>Página {page + 1} de {pages}</span>
            <Button variant="ghost" size="sm" disabled={page + 1 >= pages} onClick={() => setPage(page + 1)} aria-label="Página siguiente">
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Button>
          </nav>
        )}
      </main>

      {selected.size > 0 && (
        <ContactsBulkBar ids={[...selected]} isAdmin={isAdmin} onDone={() => setSelected(new Set())} />
      )}
      {editing !== null && <ContactFormDialog contact={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {importing && (
        <CsvImportDialog onClose={() => setImporting(false)} onCreated={batchId => { setImporting(false); setReviewing(batchId) }} />
      )}
      {reviewing && <ImportReviewDialog batchId={reviewing} onClose={() => setReviewing(null)} />}
    </div>
  )
}
