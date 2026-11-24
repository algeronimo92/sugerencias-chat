import { Checkbox } from '../../../shared/ui/Checkbox'
import { Skeleton } from '../../../shared/ui/Skeleton'
import type { Contact } from '../types'
import { ContactCard } from './ContactCard'

interface Props {
  contacts: Contact[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
  onOpenChat: (leadId: string) => void
  onPromote: (contact: Contact) => void
  promotingId: string | null
  onEdit?: (contact: Contact) => void
  onSchedule?: (contact: Contact) => void
}

// Por ancho del contenedor y no de la pantalla: el menú lateral (64 o 216 px)
// cambia cuánto espacio queda. Cuatro columnas solo cuando cada tarjeta tiene
// ~270 px, lo que necesita su pie con tres botones.
const gridClass = 'grid grid-cols-1 gap-4 @xl:grid-cols-2 @4xl:grid-cols-3 @6xl:grid-cols-4'

/** La agenda como cuadrícula de tarjetas, con "seleccionar la página" arriba. */
export function ContactList({ contacts, selected, onToggle, onToggleAll, onSchedule, onEdit, promotingId, ...actions }: Props) {
  const allSelected = contacts.length > 0 && contacts.every(contact => selected.has(contact.id))
  return (
    <div className="@container">
      <label className="mb-3 inline-flex min-h-10 cursor-pointer items-center gap-2 text-sm text-fg-muted">
        <Checkbox checked={allSelected} onCheckedChange={onToggleAll} aria-label="Seleccionar todos los de esta página" />
        <span aria-hidden="true">Seleccionar todos los de esta página</span>
      </label>
      <ul className={gridClass}>
        {contacts.map(contact => (
          <li key={contact.id}>
            <ContactCard
              contact={contact}
              selected={selected.has(contact.id)}
              onToggle={onToggle}
              promoting={promotingId === contact.id}
              onEdit={onEdit}
              onSchedule={contact.lead_id ? onSchedule : undefined}
              {...actions}
            />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Mismo molde que la cuadrícula: al llegar los datos nada salta de lugar. */
export function ContactListSkeleton() {
  return (
    <div className="@container">
      <div className="mb-3 h-10" />
      <ul className={gridClass} aria-hidden="true">
        {Array.from({ length: 8 }, (_, index) => (
          <li key={index}><Skeleton className="h-[13.5rem] w-full rounded-xl" /></li>
        ))}
      </ul>
    </div>
  )
}
