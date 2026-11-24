import { ArrowRight, Mail, Phone, PhoneOff, Plus, UserPlus } from 'lucide-react'
import { Avatar } from '../../../shared/ui/Avatar'
import { Badge } from '../../../shared/ui/Badge'
import { WhatsAppMark } from '../../../shared/ui/BrandMarks'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { cn } from '../../../shared/utils/cn'
import { ORIGIN_LABELS, formatPhone } from '../domain/selection'
import type { Contact } from '../types'

/** Cuántas etiquetas entran en la fila de pastillas antes del "+N". */
const VISIBLE_TAGS = 2

function displayName(contact: Contact) {
  return contact.nombre || contact.username || formatPhone(contact.telefono) || 'Sin nombre'
}

function lastChat(value: string | null) {
  if (!value) return null
  return new Date(value).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' })
}

// En la tarjeta de una sola columna (celular) los botones van a 40 px, que se
// tocan con el pulgar; desde dos columnas bajan a 32, que es lo que entra en
// el pie de una tarjeta de 4 columnas sin cortar "Pasar a lead".
const footerButton = 'h-10 text-sm @xl:h-8 @xl:text-xs'

export interface ContactCardProps {
  contact: Contact
  selected: boolean
  onToggle: (id: string) => void
  onOpenChat: (leadId: string) => void
  onPromote: (contact: Contact) => void
  promoting: boolean
  /** Sin permiso para editar, la tarjeta no ofrece "Ver perfil". */
  onEdit?: (contact: Contact) => void
  /** Solo con lead y permiso para agendar. */
  onSchedule?: (contact: Contact) => void
}

function ContactChips({ contact }: { contact: Contact }) {
  const tags = contact.etiquetas
  const hiddenTags = tags.length - VISIBLE_TAGS
  if (!contact.lead_id && !contact.consentimiento_marketing && !contact.eliminado_en_app_at && !tags.length) return null
  return (
    <div className="flex flex-wrap gap-1">
      {contact.lead_id && <Badge variant="accent" size="md">Lead</Badge>}
      {contact.consentimiento_marketing && <Badge variant="success" size="md">Acepta publicidad</Badge>}
      {contact.eliminado_en_app_at && (
        <Badge variant="warning" size="md">
          <PhoneOff className="h-3 w-3" aria-hidden="true" />
          Borrado del celular
        </Badge>
      )}
      {tags.slice(0, VISIBLE_TAGS).map(tag => <Badge key={tag} size="md" className="max-w-full truncate">{tag}</Badge>)}
      {hiddenTags > 0 && (
        <Badge size="md" aria-label={`${hiddenTags} etiquetas más: ${tags.slice(VISIBLE_TAGS).join(', ')}`}>
          +{hiddenTags}
        </Badge>
      )}
    </div>
  )
}

function ContactDetails({ contact }: { contact: Contact }) {
  const chatDate = lastChat(contact.ultima_interaccion_at)
  return (
    <div className="space-y-1 text-sm">
      <p className="flex min-w-0 items-center gap-2 text-fg">
        <Phone className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
        <span className="truncate tabular-nums">{formatPhone(contact.telefono) || 'Sin número'}</span>
      </p>
      {contact.email && (
        <p className="flex min-w-0 items-center gap-2 text-fg">
          <Mail className="h-3.5 w-3.5 shrink-0 text-fg-muted" aria-hidden="true" />
          <span className="truncate">{contact.email}</span>
        </p>
      )}
      {/* El punto acompaña al texto, que es el que dice si conversó o no. */}
      <p className="flex items-center gap-2 text-fg-muted">
        <span className={cn('h-2 w-2 shrink-0 rounded-full', chatDate ? 'bg-accent' : 'bg-fg-disabled')} aria-hidden="true" />
        {chatDate ? `Últ. conversación ${chatDate}` : 'Sin conversaciones'}
      </p>
    </div>
  )
}

type ActionProps = Pick<ContactCardProps, 'contact' | 'onOpenChat' | 'onPromote' | 'promoting' | 'onSchedule'> & { name: string }

/** Con lead: chat y cita. Sin lead: "Pasar a lead" ocupa ese lugar. */
function LeadActions({ contact, name, onOpenChat, onPromote, promoting, onSchedule }: ActionProps) {
  const leadId = contact.lead_id
  if (!leadId) {
    return (
      <Button
        variant="secondary"
        size="sm"
        className={footerButton}
        disabled={!contact.telefono}
        loading={promoting}
        onClick={() => onPromote(contact)}
      >
        {!promoting && <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />}
        Pasar a lead
      </Button>
    )
  }
  return (
    <>
      <Button variant="secondary" size="icon" className="h-10 w-10 shrink-0 @xl:h-8 @xl:w-8" onClick={() => onOpenChat(leadId)} aria-label={`Abrir chat con ${name}`}>
        <WhatsAppMark className="h-4 w-4" />
      </Button>
      {onSchedule && (
        <Button variant="secondary" size="sm" className={footerButton} onClick={() => onSchedule(contact)} aria-label={`Separar cita para ${name}`}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          Cita
        </Button>
      )}
    </>
  )
}

/**
 * Una persona de la agenda. Arriba quién es (avatar, nombre, de dónde vino),
 * en el medio su estado y cómo ubicarla, y abajo, separado por una línea, lo
 * que se hace con ella: chatear, agendar y, como acción principal, ver su
 * perfil. Sin lead no hay chat ni cita: el lugar lo toma "Pasar a lead".
 */
export function ContactCard({ contact, selected, onToggle, onEdit, ...actions }: ContactCardProps) {
  const name = displayName(contact)

  return (
    <article
      aria-label={name}
      className={cn(
        'flex h-full flex-col rounded-xl border transition-colors',
        selected ? 'border-line-control bg-selected' : 'border-line bg-surface',
      )}
    >
      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex items-start gap-3">
          <Avatar name={name} seed={contact.id} />
          <div className="min-w-0 flex-1 pt-0.5">
            <h2 className="truncate text-md font-semibold text-fg">{name}</h2>
            <p className="truncate text-sm text-fg-muted">{ORIGIN_LABELS[contact.origen]}</p>
          </div>
          {/* Discreta pero siempre a la vista: en táctil no hay hover que la
              muestre. La casilla mide 16 px; la etiqueta que la envuelve da
              los 40 px que se tocan con el dedo. */}
          <label className="-mr-3 -mt-3 flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center">
            <Checkbox
              checked={selected}
              onCheckedChange={() => onToggle(contact.id)}
              aria-label={`Seleccionar a ${name}`}
            />
          </label>
        </div>
        <ContactChips contact={contact} />
        <ContactDetails contact={contact} />
      </div>

      <div className="flex items-center gap-2 border-t border-line px-4 py-3">
        <LeadActions contact={contact} name={name} {...actions} />
        {onEdit && (
          <Button size="sm" className={cn(footerButton, 'min-w-0 flex-1')} onClick={() => onEdit(contact)} aria-label={`Ver perfil de ${name}`}>
            Ver perfil
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
        )}
      </div>
    </article>
  )
}
