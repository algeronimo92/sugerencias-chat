import { Phone, Tag, User, MapPin, FileText, type LucideIcon } from 'lucide-react'
import type { Chat } from '../types'
import { displayPhone } from '../utils/chat'

interface Props {
  chat: Chat
}

export function LeadInfo({ chat }: Props) {
  const fields: { label: string; value: string | null; icon: LucideIcon }[] = [
    { label: 'Teléfono', value: displayPhone(chat), icon: Phone },
    { label: 'Servicio', value: chat.servicio_interes, icon: Tag },
    { label: 'Vendedor', value: chat.vendedor, icon: User },
    { label: 'Origen', value: chat.origen, icon: MapPin },
    { label: 'Notas', value: chat.notas, icon: FileText },
  ].filter((f) => f.value)

  if (fields.length === 0) return null

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
      <h3 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
        Datos del lead
      </h3>
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
    </div>
  )
}
