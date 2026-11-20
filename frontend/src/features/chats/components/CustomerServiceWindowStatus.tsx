import { AlertTriangle, BadgePercent, Clock3, LockKeyhole, Megaphone, MessageCircle } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { Tooltip } from '../../../shared/ui/Tooltip'
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
  const days = Math.floor(seconds / 86400)
  if (days > 0) return `${days}d ${Math.floor((seconds % 86400) / 3600)}h`
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

/**
 * Aviso de la ventana de 24 h en la cabecera del chat: solo el icono y el
 * tiempo (o una palabra), en el color del estado y sin pastilla. La frase
 * entera va en el Tooltip de la app y, para el lector de pantalla, oculta.
 * Antes era una pastilla verde con "Quedan 18h 57m para responder" que
 * ocupaba media cabecera y usaba el globo nativo del navegador.
 */
function WindowStatus({ icon, short, full, hint, tone }: {
  icon: ReactNode
  short: ReactNode
  full: string
  hint: string
  tone: string
}) {
  return (
    <Tooltip content={hint}>
      <span
        tabIndex={0}
        className={`inline-flex items-center gap-1 whitespace-nowrap rounded text-xs font-medium tabular-nums outline-none focus-visible:ring-2 focus-visible:ring-ring ${tone}`}
      >
        <span className="shrink-0 [&>svg]:h-3.5 [&>svg]:w-3.5" aria-hidden="true">{icon}</span>
        <span aria-hidden="true">{short}</span>
        <span className="sr-only">{full}</span>
      </span>
    </Tooltip>
  )
}

export function CustomerServiceWindowBadge({ data, isLoading }: { data?: CustomerServiceWindow; isLoading: boolean }) {
  const remaining = useRemainingSeconds(data?.expires_at)
  const freeEntryRemaining = useRemainingSeconds(data?.free_entry_point_expires_at)
  if (isLoading && !data) {
    return (
      <span className="whitespace-nowrap text-xs text-fg-muted">
        <span aria-hidden="true">Comprobando…</span>
        <span className="sr-only">Comprobando plazo de respuesta…</span>
      </span>
    )
  }
  const isOpen = !!data?.is_open && remaining > 0
  // Sin mensajes del cliente nunca hubo ventana de 24 h: no es un vencimiento.
  const neverWrote = !!data && data.last_customer_message_at == null
  if (neverWrote) {
    return (
      <WindowStatus
        icon={<MessageCircle />}
        short="Sin mensajes"
        full="Todavía no te escribió"
        hint="Este lead todavía no escribió por WhatsApp. La ventana de 24 h arranca con su primer mensaje."
        tone="text-fg-muted"
      />
    )
  }
  if (!isOpen && freeEntryRemaining > 0) {
    const time = formatRemaining(freeEntryRemaining)
    return (
      <WindowStatus
        icon={<BadgePercent />}
        short={time}
        full={`Plantillas gratis · ${time}`}
        hint={`Venció la ventana de 24 h: para escribirle usa una plantilla aprobada. Como llegó por un anuncio, Meta no cobra ningún mensaje a este cliente hasta el ${formatExpiry(data?.free_entry_point_expires_at as string)}, ni siquiera los de marketing.`}
        tone="text-info-fg"
      />
    )
  }
  if (!isOpen) {
    return (
      <WindowStatus
        icon={<LockKeyhole />}
        short="Vencido"
        full="Venció el plazo para responder"
        hint="Pasaron más de 24 h desde el último mensaje del cliente. Para escribirle, usa una plantilla aprobada de WhatsApp."
        tone="font-semibold text-danger-fg"
      />
    )
  }
  const urgent = remaining <= 2 * 3600
  const warning = remaining <= 6 * 3600
  const time = formatRemaining(remaining)
  return (
    <WindowStatus
      icon={urgent ? <AlertTriangle /> : <Clock3 />}
      short={time}
      full={`Quedan ${time} para responder`}
      hint={`Ventana de 24 h de WhatsApp: puedes responder con mensajes libres hasta el ${formatExpiry(data.expires_at as string)}. Después, solo con plantillas aprobadas.${freeEntryRemaining > 0 ? ` Como llegó por un anuncio, Meta no cobra ningún mensaje a este cliente hasta el ${formatExpiry(data.free_entry_point_expires_at as string)}.` : ''}`}
      tone={urgent ? 'font-semibold text-danger-fg' : warning ? 'text-warning-fg' : 'text-fg-muted'}
    />
  )
}

export function CustomerServiceWindowNotice({ data }: { data?: CustomerServiceWindow }) {
  const remaining = useRemainingSeconds(data?.expires_at)
  const adReplyRemaining = useRemainingSeconds(data?.ad_reply_deadline)
  const freeEntryRemaining = useRemainingSeconds(data?.free_entry_point_expires_at)
  const isOpen = !!data?.is_open && remaining > 0
  // Va antes que el resto: responder a tiempo es lo que abre la ventana
  // gratis, y pasado el plazo ya no se puede recuperar.
  if (data && adReplyRemaining > 0) {
    return (
      <div className="flex gap-2 border-t border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
        <Megaphone className="mt-0.5 h-4 w-4 shrink-0" />
        <p>
          <span className="font-semibold">Llegó por un anuncio.</span> Si le respondes en los próximos{' '}
          <span className="font-semibold tabular-nums">{formatRemaining(adReplyRemaining)}</span>, Meta no cobra ningún
          mensaje a este cliente durante hasta 7 días (solo si tocó el anuncio desde el celular).
        </p>
      </div>
    )
  }
  if (data && !isOpen && freeEntryRemaining > 0) {
    return (
      <div className="flex gap-2 border-t border-sky-200 bg-sky-50 px-3 py-2.5 text-xs text-sky-900 dark:border-sky-900 dark:bg-sky-950/30 dark:text-sky-200">
        <BadgePercent className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold">Venció la ventana de 24 h, pero las plantillas son gratis</p>
          <p className="mt-0.5 text-[11px] opacity-80">
            WhatsApp solo acepta plantillas aprobadas hasta que el cliente vuelva a escribir. Como llegó por un anuncio,
            Meta no cobra ningún mensaje hasta el {formatExpiry(data.free_entry_point_expires_at as string)}, ni siquiera
            los de marketing.
          </p>
        </div>
      </div>
    )
  }
  if (!data || (isOpen && remaining > 2 * 3600)) return null
  if (data.last_customer_message_at == null) {
    return (
      <div className="flex gap-2 border-t border-wa-border bg-wa-field px-3 py-2.5 text-xs text-wa-muted dark:border-wa-border-dark dark:bg-wa-field-dark dark:text-wa-muted-dark">
        <MessageCircle className="mt-0.5 h-4 w-4 shrink-0" />
        <div>
          <p className="font-semibold text-wa-text dark:text-wa-text-dark">Todavía no te escribió</p>
          <p className="mt-0.5 text-[11px] opacity-80">
            Inicia tú la conversación. Si el mensaje no llega, usa una plantilla aprobada de WhatsApp.
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
            Pasó más de un día desde el último mensaje del cliente. Puedes intentar enviar igual, pero WhatsApp podría
            limitarlo o rechazarlo. Para que llegue seguro, usa una plantilla oficial aprobada.
          </p>
        </div>
      </div>
    )
  }
  return (
    <div className="flex gap-2 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <p>
        <span className="font-semibold">Quedan {formatRemaining(remaining)} para responder.</span> Envía el seguimiento
        antes de que venza el plazo de 24 h.
      </p>
    </div>
  )
}
