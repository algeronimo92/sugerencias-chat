import { useState } from 'react'
import { Contact, Phone, Tag, User, MapPin, FileText, Pencil, type LucideIcon } from 'lucide-react'
import type { Chat, LeadUpdateInput } from '../types'
import { useUpdateLead } from '../hooks/useChats'
import { displayPhone } from '../utils/chat'
import { extractErrorMessage } from '../utils/errors'
import { LeadFormDialog } from './LeadFormDialog'

interface Props {
  chat: Chat
}

export function LeadInfo({ chat }: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [editError, setEditError] = useState<string | null>(null)
  const { mutate: updateLead, isPending: isSaving } = useUpdateLead(chat.chat_id)

  const fields: { label: string; value: string | null; icon: LucideIcon }[] = [
    { label: 'Nombre', value: chat.name, icon: Contact },
    { label: 'Teléfono', value: displayPhone(chat), icon: Phone },
    { label: 'Servicio', value: chat.servicio_interes, icon: Tag },
    { label: 'Vendedor', value: chat.vendedor, icon: User },
    { label: 'Origen', value: chat.origen, icon: MapPin },
    { label: 'Notas', value: chat.notas, icon: FileText },
  ].filter((f) => f.value)

  function handleUpdate(values: LeadUpdateInput) {
    setEditError(null)
    updateLead(values, {
      onSuccess: () => setIsEditing(false),
      onError: (err) => setEditError(extractErrorMessage(err)),
    })
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide">
          Datos del lead
        </h3>
        <button
          onClick={() => {
            setEditError(null)
            setIsEditing(true)
          }}
          aria-label="Editar lead"
          className="text-gray-400 hover:text-green-600 dark:hover:text-green-500 transition-colors"
        >
          <Pencil className="w-3.5 h-3.5" />
        </button>
      </div>

      {fields.length > 0 && (
        <dl className="space-y-2.5">
          {fields.map(({ label, value, icon: Icon }) => (
            <div key={label} className="flex items-start gap-2.5 text-sm">
              <Icon className="w-4 h-4 text-gray-400 dark:text-gray-500 mt-0.5 shrink-0" />
              <div className="min-w-0">
                <dt className="text-[11px] font-medium text-gray-400 dark:text-gray-500 leading-none mb-0.5">{label}</dt>
                <dd className="text-gray-700 dark:text-gray-300 leading-snug">{value}</dd>
              </div>
            </div>
          ))}
        </dl>
      )}

      {isEditing && (
        <LeadFormDialog
          title="Editar lead"
          submitLabel="Guardar"
          initial={{
            phone: chat.phone,
            name: chat.name,
            servicio_interes: chat.servicio_interes,
            vendedor: chat.vendedor,
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
