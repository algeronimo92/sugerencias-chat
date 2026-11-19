import { ArrowUpRight, MessageCircle, Pencil, PhoneOff, UserPlus } from 'lucide-react'
import { Badge } from '../../../shared/ui/Badge'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { cn } from '../../../shared/utils/cn'
import { ORIGIN_LABELS, formatPhone } from '../domain/selection'
import type { Contact } from '../types'

interface Props {
  contacts: Contact[]
  selected: Set<string>
  onToggle: (id: string) => void
  onToggleAll: () => void
  onEdit: (contact: Contact) => void
  onOpenChat: (leadId: string) => void
  onPromote: (contact: Contact) => void
  promotingId: string | null
}

function displayName(contact: Contact) {
  return contact.nombre || contact.username || formatPhone(contact.telefono) || 'Sin nombre'
}

function lastChat(value: string | null) {
  if (!value) return null
  return new Date(value).toLocaleDateString('es-PE', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** Una fila por persona. En el celular es una tarjeta: nombre y número
 *  arriba, etiquetas y acciones abajo; en escritorio, columnas. */
export function ContactList({
  contacts, selected, onToggle, onToggleAll, onEdit, onOpenChat, onPromote, promotingId,
}: Props) {
  const allSelected = contacts.length > 0 && contacts.every(contact => selected.has(contact.id))
  return (
    <div className="overflow-hidden rounded-xl border border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-panel-dark">
      <div className="hidden items-center gap-3 border-b border-wa-border px-4 py-2 text-xs font-medium text-wa-muted md:flex dark:border-wa-border-dark dark:text-wa-muted-dark">
        <Checkbox checked={allSelected} onCheckedChange={onToggleAll} aria-label="Seleccionar todos los de esta página" />
        <span className="flex-1">Contacto</span>
        <span className="w-40">Origen</span>
        <span className="w-32">Última conversación</span>
        <span className="w-44 text-right">Acciones</span>
      </div>
      <ul className="divide-y divide-wa-border dark:divide-wa-border-dark">
        {contacts.map(contact => {
          const chatDate = lastChat(contact.ultima_interaccion_at)
          return (
            <li key={contact.id} className={cn('flex flex-col gap-2 px-4 py-3 md:flex-row md:items-center md:gap-3', selected.has(contact.id) && 'bg-wa-primary/5')}>
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Checkbox
                  checked={selected.has(contact.id)}
                  onCheckedChange={() => onToggle(contact.id)}
                  aria-label={`Seleccionar a ${displayName(contact)}`}
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-wa-text dark:text-wa-text-dark">{displayName(contact)}</p>
                  <p className="truncate text-xs text-wa-muted dark:text-wa-muted-dark">
                    {formatPhone(contact.telefono) || 'Sin número (solo identificador de WhatsApp)'}
                    {contact.email ? ` · ${contact.email}` : ''}
                  </p>
                  {(contact.etiquetas.length > 0 || contact.eliminado_en_app_at || contact.consentimiento_marketing) && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {contact.consentimiento_marketing && <Badge variant="success" size="md">Acepta publicidad</Badge>}
                      {contact.eliminado_en_app_at && (
                        <Badge variant="warning" size="md" title="Lo borraron de la agenda del celular">
                          <PhoneOff className="h-3 w-3" aria-hidden="true" />
                          Borrado del celular
                        </Badge>
                      )}
                      {contact.etiquetas.map(tag => <Badge key={tag} size="md">{tag}</Badge>)}
                    </div>
                  )}
                </div>
              </div>
              <span className="text-xs text-wa-muted md:w-40 dark:text-wa-muted-dark">{ORIGIN_LABELS[contact.origen]}</span>
              <span className="text-xs text-wa-muted md:w-32 dark:text-wa-muted-dark">{chatDate ?? '—'}</span>
              <div className="flex items-center gap-1 md:w-44 md:justify-end">
                {contact.lead_id ? (
                  <Button variant="ghost" size="sm" onClick={() => onOpenChat(contact.lead_id ?? '')}>
                    <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                    Abrir chat
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!contact.telefono || promotingId === contact.id}
                    title={contact.telefono ? 'Crea su lead en la primera etapa del embudo' : 'Sin número no se le puede abrir un chat'}
                    onClick={() => onPromote(contact)}
                  >
                    {promotingId === contact.id
                      ? <ArrowUpRight className="h-3.5 w-3.5 animate-pulse" aria-hidden="true" />
                      : <UserPlus className="h-3.5 w-3.5" aria-hidden="true" />}
                    Pasar a lead
                  </Button>
                )}
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => onEdit(contact)} aria-label={`Editar a ${displayName(contact)}`}>
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
