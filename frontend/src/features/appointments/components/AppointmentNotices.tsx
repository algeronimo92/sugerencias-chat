import { AlertTriangle, Check, CheckCheck, Clock, MessageCircle, RefreshCw, XCircle } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '../../../shared/utils/cn'
import { isFailedNotice, noticeRecipient, noticeState, type NoticeTone } from '../domain/noticeStatus'
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

type Props = {
  notices: AppointmentNotice[]
  leadId: string | null
  /** Sin él no se ofrece reenviar (quien mira no puede editar la cita). */
  onRetry?: () => void
  retrying?: boolean
  retryError?: string | null
}

/** Los avisos de WhatsApp de una cita: a quién le llegó y a quién no, con el
 *  motivo. El del cliente lleva al chat del lead, donde está el mensaje. Los
 *  que fallaron se pueden reenviar (p. ej. tras reconectar el número de avisos). */
export function AppointmentNotices({ notices, leadId, onRetry, retrying = false, retryError = null }: Props) {
  if (notices.length === 0) return null
  const failed = notices.filter(isFailedNotice).length
  return (
    <section aria-label="Avisos por WhatsApp" className="mt-2">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">
          <MessageCircle className="h-3 w-3" aria-hidden="true" /> Avisos por WhatsApp
        </p>
        {onRetry && failed > 0 && (
          <button
            type="button"
            onClick={onRetry}
            disabled={retrying}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold text-wa-primary-strong hover:bg-green-50 disabled:opacity-50 dark:text-wa-primary dark:hover:bg-green-950/30"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', retrying && 'animate-spin')} aria-hidden="true" />
            {failed === 1 ? 'Reenviar aviso fallido' : `Reenviar ${failed} avisos fallidos`}
          </button>
        )}
      </div>
      {retryError && <p role="alert" className="mb-1 text-xs text-red-600 dark:text-red-400">{retryError}</p>}
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
