import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CircleDot, Contact, Phone, Tag, User, MapPin, FileText, Pencil, type LucideIcon } from 'lucide-react'
import type { Chat, LeadUpdateInput } from '../types'
import { LEAD_STAGE_META } from '../domain/leadStageMeta'
import { useUpdateLead } from '../hooks/useChats'
import { displayPhone } from '../utils/chat'
import { extractErrorMessage } from '../utils/errors'
import { LeadFormDialog } from './LeadFormDialog'

interface Props {
  chat: Chat
}

interface LeadInfoField {
  label: string
  value: string | null
  icon: LucideIcon
  iconClassName?: string
  valueClassName?: string
}

export function LeadInfo({ chat }: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const navigate = useNavigate()
  const { mutate: updateLead, isPending: isSaving } = useUpdateLead(chat.chat_id)
  const stageMeta = LEAD_STAGE_META[chat.stage]

  const fields: LeadInfoField[] = [
    { label: 'Nombre', value: chat.name, icon: Contact },
    { label: 'Teléfono', value: displayPhone(chat), icon: Phone },
    { label: 'Estado', value: stageMeta.label, icon: CircleDot, iconClassName: stageMeta.accent, valueClassName: stageMeta.badge },
    { label: 'Servicio', value: chat.servicio_interes, icon: Tag },
    { label: 'Vendedor', value: chat.vendedor, icon: User },
    { label: 'Origen', value: chat.origen, icon: MapPin },
    { label: 'Notas', value: chat.notas, icon: FileText },
  ].filter((f) => f.value)

  function handleUpdate(values: LeadUpdateInput) {
    if (isSaving) return
    setEditError(null)
    updateLead(values, {
      onSuccess: (updated) => {
        setIsEditing(false)
        // Cambió el número: el lead vive bajo otro chat_id, hay que seguirlo.
        if (updated.chat_id !== chat.chat_id) navigate(`/chat/${updated.chat_id}`)
      },
      onError: (err) => setEditError(extractErrorMessage(err)),
    })
  }

  return (
    <div className="bg-white dark:bg-wa-head-dark rounded-xl border border-wa-border dark:border-wa-border-dark p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-wa-muted dark:text-wa-muted-dark uppercase tracking-wide">
          Datos del lead
        </h3>
        <button
          onClick={() => {
            setEditError(null)
            setIsEditing(true)
          }}
          aria-label="Editar lead"
          className="text-wa-muted dark:text-wa-muted-dark hover:text-wa-primary-strong dark:hover:text-wa-primary transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      {fields.length > 0 && (
        <dl className="space-y-2.5">
          {fields.map(({ label, value, icon: Icon, iconClassName, valueClassName }) => (
            <div key={label} className="flex items-start gap-2.5 text-sm">
              <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${iconClassName ?? 'text-wa-muted dark:text-wa-muted-dark'}`} />
              <div className="min-w-0">
                <dt className="text-[11px] font-medium text-wa-muted dark:text-wa-muted-dark leading-none mb-0.5">{label}</dt>
                <dd className={valueClassName ? `inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${valueClassName}` : 'text-gray-700 dark:text-gray-300 leading-snug'}>
                  {value}
                </dd>
              </div>
            </div>
          ))}
        </dl>
      )}

      {isEditing && (
        <LeadFormDialog
          title="Editar lead"
          submitLabel="Guardar"
          canEditPhone={chat.last_message == null}
          initial={{
            phone: chat.phone,
            name: chat.name,
            servicio_interes: chat.servicio_interes,
            vendedor_id: chat.vendedor_id,
            origen: chat.origen,
            notas: chat.notas,
          }}
          isSubmitting={isSaving}
          error={editError}
          onSubmit={handleUpdate}
          onCancel={() => setIsEditing(false)}
        />
      )}
    </div>
  )
}
