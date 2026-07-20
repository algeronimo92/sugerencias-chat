import { useEffect, useState } from 'react'
import { AlertTriangle, Clock3, LockKeyhole } from 'lucide-react'
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

export function CustomerServiceWindowBadge({ data, isLoading }: { data?: CustomerServiceWindow; isLoading: boolean }) {
  const remaining = useRemainingSeconds(data?.expires_at)
  if (isLoading && !data) return <span className="text-[10px] text-gray-400">Comprobando ventana...</span>
  const isOpen = !!data?.is_open && remaining > 0
  if (!isOpen) {
    return (
      <span title="WhatsApp puede limitar mensajes enviados fuera de esta ventana" className="inline-flex items-center gap-1 rounded-full bg-red-50 px-2 py-1 text-[10px] font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-400">
        <LockKeyhole className="h-3 w-3" /> Ventana cerrada
      </span>
    )
  }
  const urgent = remaining <= 2 * 3600
  const warning = remaining <= 6 * 3600
  return (
    <span title={`La ventana vence ${new Date(data.expires_at as string).toLocaleString()}`} className={`inline-flex items-center gap-1 rounded-full px-2 py-1 text-[10px] font-semibold ${urgent ? 'bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-400' : warning ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400' : 'bg-green-50 text-green-700 dark:bg-green-950/40 dark:text-green-400'}`}>
      {urgent ? <AlertTriangle className="h-3 w-3" /> : <Clock3 className="h-3 w-3" />}
      {formatRemaining(remaining)}
    </span>
  )
}

export function CustomerServiceWindowNotice({ data }: { data?: CustomerServiceWindow }) {
  const remaining = useRemainingSeconds(data?.expires_at)
  const isOpen = !!data?.is_open && remaining > 0
  if (!data || (isOpen && remaining > 2 * 3600)) return null
  if (!isOpen) {
    return (
      <div className="flex gap-2 border-t border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
        <LockKeyhole className="mt-0.5 h-4 w-4 shrink-0" />
        <div><p className="font-semibold">La ventana de 24 horas está cerrada</p><p className="mt-0.5 text-[11px] opacity-80">Puedes intentar enviar el mensaje, pero WhatsApp podría limitarlo o rechazarlo. Para una entrega compatible fuera de la ventana, utiliza una plantilla oficial aprobada.</p></div>
      </div>
    )
  }
  return (
    <div className="flex gap-2 border-t border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <p><span className="font-semibold">La ventana vence en {formatRemaining(remaining)}.</span> Envía el seguimiento antes de que cierre.</p>
    </div>
  )
}
