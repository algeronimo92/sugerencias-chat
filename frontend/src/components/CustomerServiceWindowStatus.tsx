import { useEffect, useState } from 'react'
import { AlertTriangle, Clock3, LockKeyhole, MessageCircle } from 'lucide-react'
import type { CustomerServiceWindow } from '../types'

function useRemainingSeconds(expiresAt: string | null | undefined) {
  const [remaining, setRemaining] = useState(0)
  useEffect(() => {
    function update() {
      setRemaining(expiresAt ? Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000)) : 0)
    }
    update()
    const interval = window.setInterval(update, 1000)
    return () => window.clearInterval(interval)
  }, [expiresAt])
  return remaining
}

function formatRemaining(seconds: number) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m ${secs.toString().padStart(2, '0')}s`
}

function formatExpiry(expiresAt: string) {
  return new Date(expiresAt).toLocaleString(undefined, {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function CustomerServiceWindowBadge({ data, isLoading }: { data?: CustomerServiceWindow; isLoading: boolean }) {
  const remaining = useRemainingSeconds(data?.expires_at)
  if (isLoading && !data) {
    return <span className="text-[10px] text-wa-muted dark:text-wa-muted-dark">Comprobando plazo de respuesta…</span>
  }
  const isOpen = !!data?.is_open && remaining > 0
  // Sin mensajes del cliente nunca hubo ventana de 24 h: no es un vencimiento.
  const neverWrote = !!data && data.last_customer_message_at == null
  if (neverWrote) {
    return (
      <span
        title="Este lead todavía no escribió por WhatsApp. La ventana de 24 h arranca con su primer mensaje."
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-wa-field px-2 py-1 text-[10px] font-medium text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark"
      >
        <MessageCircle className="h-3 w-3 shrink-0" /> Todavía no te escribió
      </span>
    )
  }
  if (!isOpen) {
    return (
      <span
        title="Pasaron más de 24 h desde el último mensaje del cliente. Para escribirle, usá una plantilla aprobada de WhatsApp."
        className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-400"
      >
        <LockKeyhole className="h-3 w-3 shrink-0" /> Venció el plazo para responder
      </span>
    )
  }
  const urgent = remaining <= 2 * 3600
  const warning = remaining <= 6 * 3600
  return (
    <span
      title={`Ventana de 24 h de WhatsApp: podés responder con mensajes libres hasta el ${formatExpiry(data.expires_at as string)}. Después, solo con plantillas aprobadas.`}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-medium ${urgent ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400' : warning ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' : 'bg-green-50 text-wa-primary-strong dark:bg-green-950/40 dark:text-wa-primary'}`}
    >
      {urgent ? <AlertTriangle className="h-3 w-3 shrink-0" /> : <Clock3 className="h-3 w-3 shrink-0" />}
      <span>
        Quedan <span className="font-semibold tabular-nums">{formatRemaining(remaining)}</span> para responder
      </span>
    </span>
  )
}

export function CustomerServiceWindowNotice({ data }: { data?: CustomerServiceWindow }) {
  const remaining = useRemainingSeconds(data?.expires_at)
  const isOpen = !!data?.is_open && remaining > 0
  if (!data || (isOpen && remaining > 2 * 3600)) return null
  if (data.last_customer_message_at == null) {
    return (
      <div className="flex gap-2 border-t border-wa-border bg-wa-field px-3 py-2.5 text-xs text-wa-muted dark:border-wa-border-dark dark:bg-wa-field-dark dark:text-wa-muted-dark">
        <MessageCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold text-wa-text dark:text-wa-text-dark">Todavía no te escribió</p>
          <p className="mt-0.5 text-[11px] opacity-80">
            Iniciá vos la conversación. Si el mensaje no llega, usá una plantilla aprobada de WhatsApp.
          </p>
        </div>
      </div>
    )
  }
  if (!isOpen) {
    return (
      <div className="flex gap-2 border-t border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">Venció el plazo de 24 h para responder</p>
          <p className="mt-0.5 text-[11px] opacity-80">
            Pasó más de un día desde el último mensaje del cliente. Podés intentar enviar igual, pero WhatsApp podría
            limitarlo o rechazarlo. Para que llegue seguro, usá una plantilla oficial aprobada.
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-2 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <p>
        <span className="font-semibold">Quedan {formatRemaining(remaining)} para responder.</span> Enviá el seguimiento
        antes de que venza el plazo de 24 h.
      </p>
    </div>
  )
}
