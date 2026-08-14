import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Copy, Loader2, MessageCircle } from 'lucide-react'

import type { LeadUpdateInput } from '../types'
import type { SharedContact } from '../utils/message'
import { useCreateLead, useFindLeadByPhone, usePhoneConfig } from '../hooks/useChats'
import { FALLBACK_COUNTRY_CODE, formatPhonePreview, normalizePhone } from '../utils/phone'
import { extractErrorMessage } from '../utils/errors'
import { LeadFormDialog } from './LeadFormDialog'

/** Tarjeta de un contacto compartido, con las mismas acciones que WhatsApp:
 * abrir la conversación con ese número (creándole el lead si todavía no lo
 * tiene) y copiar el teléfono. */
export function ContactCard({ contacts }: { contacts: SharedContact[] }) {
  return (
    <div className="flex flex-col gap-1">
      {contacts.map((contact, index) => (
        <ContactEntry key={index} contact={contact} />
      ))}
    </div>
  )
}

function ContactEntry({ contact }: { contact: SharedContact }) {
  const navigate = useNavigate()
  const findLeadByPhone = useFindLeadByPhone()
  const { data: phoneConfig } = usePhoneConfig()
  const { mutate: createLead, isPending: isCreatingLead } = useCreateLead()
  const [isSearching, setIsSearching] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const countryCode = phoneConfig?.default_country_code ?? FALLBACK_COUNTRY_CODE
  // El vCard puede traer el número en formato local ("987 654 321"): se
  // normaliza con el mismo criterio que el alta de leads antes de buscarlo.
  const phoneCheck = normalizePhone(contact.phone ?? '', countryCode)
  const digits = phoneCheck.status === 'valid' ? phoneCheck.digits : null
  const name = contact.fullName || 'Contacto'
  const phoneLabel =
    contact.phoneLabel || (digits ? formatPhonePreview(digits, countryCode) : '')

  async function handleOpenChat() {
    if (!digits || isSearching) return
    setError(null)
    setIsSearching(true)
    try {
      const existing = await findLeadByPhone(digits)
      if (existing) navigate(`/chat/${existing.chat_id}`)
      // Sin lead todavía: se abre el alta con el nombre y el número ya
      // cargados, para no crear nada a espaldas del vendedor y para que el
      // formulario haga su verificación de WhatsApp.
      else setIsCreating(true)
    } catch (err) {
      setError(extractErrorMessage(err))
    } finally {
      setIsSearching(false)
    }
  }

  function handleCreateLead(values: LeadUpdateInput) {
    if (isCreatingLead) return
    setError(null)
    createLead(
      {
        phone: values.phone ?? '',
        name: values.name ?? '',
        servicio_interes: values.servicio_interes,
        vendedor_id: values.vendedor_id,
        origen: values.origen,
        notas: values.notas,
      },
      {
        onSuccess: (chat) => {
          setIsCreating(false)
          navigate(`/chat/${chat.chat_id}`)
        },
        onError: (err) => setError(extractErrorMessage(err)),
      },
    )
  }

  async function handleCopy() {
    if (!phoneLabel) return
    await navigator.clipboard.writeText(digits ? `+${digits}` : phoneLabel)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const isBusy = isSearching || isCreatingLead

  return (
    <div className="overflow-hidden rounded-lg bg-black/5 dark:bg-white/10">
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-wa-primary/20 text-xs font-semibold text-wa-primary-strong dark:text-wa-primary">
          {name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium not-italic text-wa-text dark:text-wa-text-dark">{name}</p>
          {phoneLabel && (
            <p className="truncate text-[11px] not-italic text-wa-muted dark:text-wa-text-dark/60">{phoneLabel}</p>
          )}
        </div>
        {phoneLabel && (
          <button
            type="button"
            onClick={(event) => { event.stopPropagation(); void handleCopy() }}
            aria-label={copied ? 'Número copiado' : 'Copiar número'}
            title={copied ? 'Copiado' : 'Copiar número'}
            className="shrink-0 rounded-md p-1.5 text-wa-muted transition-colors hover:bg-black/10 hover:text-wa-text dark:text-wa-text-dark/60 dark:hover:bg-white/10 dark:hover:text-wa-text-dark"
          >
            {copied
              ? <Check aria-hidden="true" className="h-4 w-4 text-wa-primary" />
              : <Copy aria-hidden="true" className="h-4 w-4" />}
          </button>
        )}
      </div>

      {digits ? (
        <button
          type="button"
          onClick={(event) => { event.stopPropagation(); void handleOpenChat() }}
          disabled={isBusy}
          className="flex w-full items-center justify-center gap-1.5 border-t border-black/10 py-1.5 text-xs font-semibold not-italic text-wa-primary-strong transition-colors hover:bg-black/5 disabled:opacity-60 dark:border-white/15 dark:text-wa-primary dark:hover:bg-white/10"
        >
          {isBusy
            ? <Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />
            : <MessageCircle aria-hidden="true" className="h-3.5 w-3.5" />}
          Enviar mensaje
        </button>
      ) : (
        <p className="border-t border-black/10 px-3 py-1.5 text-[11px] not-italic text-wa-muted dark:border-white/15 dark:text-wa-text-dark/60">
          No llegó el número de este contacto
        </p>
      )}

      {error && (
        <p className="border-t border-black/10 px-3 py-1.5 text-[11px] not-italic text-red-600 dark:border-white/15 dark:text-red-400">
          {error}
        </p>
      )}

      {isCreating && (
        <LeadFormDialog
          title="Agregar lead"
          submitLabel="Agregar"
          requirePhoneAndName
          initial={{ phone: digits ?? '', name: contact.fullName }}
          isSubmitting={isCreatingLead}
          error={error}
          onSubmit={handleCreateLead}
          onCancel={() => { setIsCreating(false); setError(null) }}
          onOpenExisting={(chat) => { setIsCreating(false); navigate(`/chat/${chat.chat_id}`) }}
        />
      )}
    </div>
  )
}
