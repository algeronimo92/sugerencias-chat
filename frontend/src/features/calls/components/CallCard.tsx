import { PhoneIncoming, PhoneMissed, PhoneOff, PhoneOutgoing } from 'lucide-react'

import { formatDuration } from '../domain/callSession'
import type { Call } from '../types'

function describe(call: Call): { text: string; tone: 'ok' | 'bad' | 'live'; icon: typeof PhoneIncoming } {
  const inbound = call.direction === 'inbound'
  const base = inbound ? 'Llamada entrante' : 'Llamada saliente'
  const icon = inbound ? PhoneIncoming : PhoneOutgoing
  switch (call.status) {
    case 'completed': {
      const parts = [base]
      if (call.duration_seconds != null) parts.push(formatDuration(call.duration_seconds))
      if (call.handled_by_name) parts.push(`atendió ${call.handled_by_name}`)
      return { text: parts.join(' · '), tone: 'ok', icon }
    }
    case 'missed':
      return { text: ['Llamada perdida', call.cause_label].filter(Boolean).join(' · '), tone: 'bad', icon: PhoneMissed }
    case 'rejected':
      return { text: 'Llamada rechazada', tone: 'bad', icon: PhoneOff }
    case 'failed':
      return { text: ['Llamada fallida', call.cause_label].filter(Boolean).join(' · '), tone: 'bad', icon: PhoneOff }
    default:
      return { text: `${base} · en curso`, tone: 'live', icon }
  }
}

const TONES = {
  ok: 'bg-wa-field text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark',
  bad: 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  live: 'bg-green-50 text-green-800 dark:bg-green-950/40 dark:text-green-200',
}

/** Una llamada dentro del hilo del chat, en el momento en que ocurrió. */
export function CallCard({ call }: { call: Call }) {
  const { text, tone, icon: Icon } = describe(call)
  const time = new Date(call.ringing_at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' })
  return (
    <div className="my-2 flex justify-center">
      <p className={`inline-flex max-w-[90%] items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${TONES[tone]}`}>
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{text}</span>
        <span className="shrink-0 opacity-70">{time}</span>
      </p>
    </div>
  )
}
