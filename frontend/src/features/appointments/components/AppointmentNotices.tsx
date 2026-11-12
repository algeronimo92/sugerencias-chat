import { AlertTriangle, Check, CheckCheck, Clock, MessageCircle, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '../../../shared/utils/cn'
import { noticeRecipient, noticeState, type NoticeTone } from '../domain/noticeStatus'
import type { AppointmentNotice } from '../types'

const TONES: Record<NoticeTone, string> = {
  success: 'border-green-200 bg-green-50 text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300',
  neutral: 'border-wa-border bg-wa-field text-wa-text dark:border-wa-border-dark dark:bg-wa-field-dark dark:text-wa-text-dark',
  danger: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300',
  warning: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300',
}

function iconFor(notice: AppointmentNotice): LucideIcon {
  if (notice.status === 'skipped') return AlertTriangle
  if (notice.status === 'failed' || notice.delivery_status === 'failed') return XCircle
  if (notice.delivery_status === 'read' || notice.delivery_status === 'delivered') return CheckCheck
  if (notice.delivery_status === 'sent') return Check
  return Clock
}

/** Los avisos de WhatsApp de una cita: a quién le llegó y a quién no, con el
 *  motivo. El del cliente lleva al chat del lead, donde está el mensaje. */
export function AppointmentNotices({ notices, leadId }: { notices: AppointmentNotice[]; leadId: string | null }) {
  if (notices.length === 0) return null
  return (
    <section aria-label="Avisos por WhatsApp" className="mt-2">
      <p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">
        <MessageCircle className="h-3 w-3" aria-hidden="true" /> Avisos por WhatsApp
      </p>
      <ul className="flex flex-wrap gap-1.5">
        {notices.map(notice => {
          const state = noticeState(notice)
          const Icon = iconFor(notice)
          const label = (
            <>
              <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span className="font-medium">{noticeRecipient(notice)}</span>
              <span aria-hidden="true">·</span>
              <span>{state.label}</span>
            </>
          )
          const className = cn('inline-flex max-w-full items-center gap-1 rounded-full border px-2 py-0.5 text-[11px]', TONES[state.tone])
          const name = `${noticeRecipient(notice)}: ${state.label}`
          return (
            <li key={notice.id} className="max-w-full" title={notice.reason ?? undefined}>
              {notice.audience === 'client' && leadId && notice.status === 'sent' ? (
                <Link to={`/chat/${leadId}`} aria-label={`${name}. Ver el chat`} className={cn(className, 'hover:underline')}>{label}</Link>
              ) : (
                <span role="img" aria-label={name} className={className}>{label}</span>
              )}
              {notice.reason && (
                <span className="ml-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">{notice.reason}</span>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
