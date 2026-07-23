import { useEffect, useState } from 'react'
import { AlertCircle, CalendarClock, CheckCheck, Loader2, Plus, Send, X } from 'lucide-react'

import type { Chat, ScheduledMessage, ScheduledMessageStatus } from '../types'
import {
  useCancelScheduledMessage,
  useCreateScheduledMessage,
  useScheduledMessages,
} from '../hooks/useScheduledMessages'
import { extractErrorMessage } from '../utils/errors'


function toLocalInput(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}


function defaultScheduledAt() {
  const date = new Date(Date.now() + 60 * 60 * 1000)
  date.setSeconds(0, 0)
  return toLocalInput(date)
}


const STATUS_META: Record<ScheduledMessageStatus, { label: string; className: string }> = {
  scheduled: { label: 'Programado', className: 'bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300' },
  processing: { label: 'Preparando', className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' },
  queued: { label: 'Enviando', className: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300' },
  sent: { label: 'Enviado', className: 'bg-green-50 text-wa-primary-strong dark:bg-green-950/50 dark:text-green-300' },
  failed: { label: 'No enviado', className: 'bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300' },
  cancelled: { label: 'Cancelado', className: 'bg-wa-field text-gray-600 dark:bg-wa-active-dark dark:text-gray-300' },
}


function ScheduledItem({
  item,
  cancelling,
  onCancel,
}: {
  item: ScheduledMessage
  cancelling: boolean
  onCancel: () => void
}) {
  const meta = STATUS_META[item.status]
  const canCancel = item.status === 'scheduled' || item.status === 'failed'

  return (
    <div className="rounded-lg border border-wa-border bg-wa-hover p-2.5 dark:border-wa-border-dark dark:bg-wa-panel-dark/60">
      <div className="flex items-start gap-2">
        {item.status === 'sent' ? (
          <CheckCheck className="mt-0.5 h-4 w-4 shrink-0 text-wa-primary-strong" />
        ) : item.status === 'failed' ? (
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        ) : (
          <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-blue-600" />
        )}
        <div className="min-w-0 flex-1">
          <p className="whitespace-pre-wrap break-words text-xs text-gray-800 dark:text-wa-text-dark">{item.text}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${meta.className}`}>
              {meta.label}
            </span>
            <span className="text-[10px] text-wa-muted dark:text-wa-muted-dark">
              {new Date(item.scheduled_at).toLocaleString('es-PE')}
            </span>
          </div>
          {item.error && <p className="mt-1.5 text-[11px] text-red-500">{item.error}</p>}
        </div>
        {canCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            aria-label={item.status === 'failed' ? 'Descartar mensaje fallido' : 'Cancelar mensaje programado'}
            title={item.status === 'failed' ? 'Descartar' : 'Cancelar envío'}
            className="rounded-md p-1 text-wa-muted hover:bg-wa-border hover:text-red-500 disabled:opacity-40 dark:hover:bg-wa-active-dark"
          >
            {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          </button>
        )}
      </div>
    </div>
  )
}


export function ScheduledMessageCard({ chat }: { chat: Chat }) {
  const { data = [], isLoading } = useScheduledMessages(chat.chat_id)
  const create = useCreateScheduledMessage(chat.chat_id)
  const cancel = useCancelScheduledMessage(chat.chat_id)
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const [scheduledAt, setScheduledAt] = useState(defaultScheduledAt)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setOpen(false)
    setText('')
    setScheduledAt(defaultScheduledAt())
    setError(null)
  }, [chat.chat_id])

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError(null)
    const value = text.trim()
    if (!value) {
      setError('Escribe el mensaje que se enviará.')
      return
    }
    const date = new Date(scheduledAt)
    if (Number.isNaN(date.getTime()) || date.getTime() <= Date.now()) {
      setError('Elige una fecha y hora futuras.')
      return
    }
    create.mutate(
      { text: value, scheduledAt: date.toISOString() },
      {
        onSuccess: () => {
          setOpen(false)
          setText('')
          setScheduledAt(defaultScheduledAt())
        },
        onError: (err) => setError(extractErrorMessage(err)),
      },
    )
  }

  function handleCancel(item: ScheduledMessage) {
    setError(null)
    cancel.mutate(item.id, { onError: (err) => setError(extractErrorMessage(err)) })
  }

  return (
    <div className="rounded-xl border border-wa-border bg-white p-3 shadow-sm dark:border-wa-border-dark dark:bg-wa-head-dark">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">
          <Send className="h-3.5 w-3.5" /> Mensajes programados
        </div>
        <button
          type="button"
          onClick={() => setOpen((current) => !current)}
          aria-label="Programar un mensaje de WhatsApp"
          title="Programar mensaje"
          className="rounded-md p-1 text-wa-muted hover:bg-wa-field hover:text-wa-primary-strong dark:text-wa-muted-dark dark:hover:bg-wa-active-dark"
        >
          {open ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
        </button>
      </div>

      {open && (
        <form onSubmit={handleSubmit} className="mt-3 space-y-2 border-t border-wa-border pt-3 dark:border-wa-border-dark">
          <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-300">
            Mensaje para el cliente
            <textarea
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={4096}
              rows={3}
              required
              placeholder="Ej. Hola, ¿pudiste realizar el pago?"
              className="mt-1 w-full resize-y rounded-md border border-wa-border bg-white px-2 py-1.5 text-xs text-gray-800 outline-none focus:border-wa-primary dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
            />
          </label>
          <label className="block text-[11px] font-medium text-gray-600 dark:text-gray-300">
            Fecha y hora de envío
            <input
              type="datetime-local"
              value={scheduledAt}
              min={toLocalInput(new Date())}
              onChange={(event) => setScheduledAt(event.target.value)}
              required
              className="mt-1 w-full rounded-md border border-wa-border bg-white px-2 py-1.5 text-xs text-gray-800 dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
            />
          </label>
          <p className="text-[11px] leading-relaxed text-wa-muted">
            Se enviará automáticamente aunque cierres el navegador. A esa hora se verificará la ventana de atención de 24 horas de WhatsApp.
          </p>
          <button
            disabled={create.isPending}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-wa-primary py-1.5 text-xs font-medium text-white hover:bg-wa-primary-strong disabled:opacity-40"
          >
            {create.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CalendarClock className="h-3.5 w-3.5" />}
            Programar envío
          </button>
        </form>
      )}

      <div className="mt-2 space-y-2">
        {isLoading && <div className="flex justify-center py-2"><Loader2 className="h-4 w-4 animate-spin text-wa-muted" /></div>}
        {!isLoading && data.length === 0 && !open && (
          <p className="text-xs text-wa-muted">No hay mensajes pendientes de envío.</p>
        )}
        {data.map((item) => (
          <ScheduledItem
            key={item.id}
            item={item}
            cancelling={cancel.isPending && cancel.variables === item.id}
            onCancel={() => handleCancel(item)}
          />
        ))}
      </div>
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  )
}
