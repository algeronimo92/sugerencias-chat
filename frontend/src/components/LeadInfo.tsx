import type { Chat } from '../types'
import { displayPhone } from '../utils/chat'

interface Props {
  chat: Chat
}

export function LeadInfo({ chat }: Props) {
  const fields = [
    { label: 'Teléfono', value: displayPhone(chat) },
    { label: 'Servicio', value: chat.servicio_interes },
    { label: 'Vendedor', value: chat.vendedor },
    { label: 'Origen', value: chat.origen },
    { label: 'Notas', value: chat.notas },
  ].filter((f) => f.value)

  if (fields.length === 0) return null

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
        Datos del Lead
      </h3>
      <dl className="space-y-1.5">
        {fields.map(({ label, value }) => (
          <div key={label} className="flex gap-2 text-sm">
            <dt className="font-medium text-gray-400 w-20 shrink-0">{label}:</dt>
            <dd className="text-gray-700">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}
