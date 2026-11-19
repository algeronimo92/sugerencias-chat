import { Mic, MicOff, Phone, PhoneIncoming, PhoneOff, WifiOff, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { useCallCenter } from '../callCenterContext'
import { isDevicePrepared, prepareDevice } from '../devicePreparation'
import { endMessage, formatDuration } from '../domain/callSession'
import type { Call } from '../types'

const card = 'pointer-events-auto w-full rounded-2xl border border-wa-border bg-white p-4 shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark sm:w-80'
const roundButton = 'inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full text-white outline-none transition-transform focus-visible:ring-4 active:scale-95 sm:h-11 sm:w-11'

function callerLabel(name: string | null | undefined): string {
  return name?.trim() || 'Cliente'
}

function IncomingCall({ call, busy, onAnswer, onDismiss }: { call: Call; busy: boolean; onAnswer: () => void; onDismiss: () => void }) {
  return (
    <div role="alertdialog" aria-label={`Llamada entrante de ${callerLabel(call.caller_name)}`} className={card}>
      <p className="flex items-center gap-2 text-xs font-medium text-wa-muted dark:text-wa-muted-dark">
        <PhoneIncoming className="h-4 w-4 text-wa-primary-strong dark:text-wa-primary" aria-hidden="true" />
        {busy ? 'Otra llamada' : 'Llamada entrante'}
      </p>
      <p className="mt-1 truncate text-xl font-semibold text-wa-text dark:text-wa-text-dark sm:text-base">{callerLabel(call.caller_name)}</p>
      <div className="mt-4 flex items-center justify-center gap-10 sm:justify-end sm:gap-3">
        <button type="button" onClick={onDismiss} aria-label="Ignorar" title="Ignorar: deja de sonarte, no le corta al cliente" className={`${roundButton} bg-wa-muted focus-visible:ring-wa-muted/40`}>
          <X className="h-6 w-6 sm:h-5 sm:w-5" aria-hidden="true" />
        </button>
        {/* Con una llamada en curso no se puede atender otra: se avisa sin sonido. */}
        {!busy && (
          <button type="button" onClick={onAnswer} aria-label="Atender" className={`${roundButton} bg-green-600 focus-visible:ring-green-300`}>
            <Phone className="h-6 w-6 sm:h-5 sm:w-5" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  )
}

function Timer({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(interval)
  }, [])
  return <span className="tabular-nums">{formatDuration((now - startedAt) / 1000)}</span>
}

function CurrentCall() {
  const { session, hangUp, toggleMute, clearEnded } = useCallCenter()
  const navigate = useNavigate()
  if (session.phase === 'idle') return null
  const name = callerLabel(session.call.callerName)

  if (session.phase === 'ended') {
    return (
      <div role="status" className={card}>
        <p className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">{endMessage(session.reason, session.durationSeconds)}</p>
        <p className="truncate text-xs text-wa-muted dark:text-wa-muted-dark">{name}</p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" onClick={clearEnded} className="rounded-lg px-3 py-2 text-xs text-wa-muted hover:bg-wa-hover dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark">Cerrar</button>
          <button
            type="button"
            onClick={() => { clearEnded(); navigate(`/chat/${session.call.chatId}`) }}
            className="rounded-lg bg-wa-primary-strong px-3 py-2 text-xs font-semibold text-white"
          >
            Abrir chat
          </button>
        </div>
      </div>
    )
  }

  const active = session.phase === 'active'
  return (
    <div role="region" aria-label={`Llamada con ${name}`} className={card}>
      <p className="truncate text-xl font-semibold text-wa-text dark:text-wa-text-dark sm:text-base">{name}</p>
      <p role="status" className="text-sm text-wa-muted dark:text-wa-muted-dark">
        {active ? <Timer startedAt={session.startedAt} /> : session.outbound ? 'Llamando…' : 'Conectando…'}
      </p>
      {active && session.muted && (
        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
          <MicOff className="h-3.5 w-3.5" aria-hidden="true" /> Micrófono apagado
        </p>
      )}
      {active && session.unstable && (
        <p className="mt-1 flex items-center gap-1 text-xs font-medium text-amber-700 dark:text-amber-300">
          <WifiOff className="h-3.5 w-3.5" aria-hidden="true" /> Conexión inestable
        </p>
      )}
      <div className="mt-4 flex items-center justify-center gap-10 sm:justify-end sm:gap-3">
        <button
          type="button" onClick={toggleMute} disabled={!active}
          aria-pressed={active && session.muted} aria-label={active && session.muted ? 'Activar micrófono' : 'Silenciar'}
          className={`${roundButton} bg-wa-muted focus-visible:ring-wa-muted/40 disabled:opacity-40`}
        >
          {active && session.muted ? <MicOff className="h-6 w-6 sm:h-5 sm:w-5" aria-hidden="true" /> : <Mic className="h-6 w-6 sm:h-5 sm:w-5" aria-hidden="true" />}
        </button>
        <button type="button" onClick={hangUp} aria-label="Colgar" className={`${roundButton} bg-red-600 focus-visible:ring-red-300`}>
          <PhoneOff className="h-6 w-6 sm:h-5 sm:w-5" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}

function PrepareDevice() {
  const [state, setState] = useState<'pending' | 'working' | 'blocked' | 'done'>(() => (isDevicePrepared() ? 'done' : 'pending'))
  if (state === 'done') return null
  async function prepare() {
    setState('working')
    setState(await prepareDevice() === 'ready' ? 'done' : 'blocked')
  }
  return (
    <div role="region" aria-label="Preparar este dispositivo para llamadas" className={card}>
      <p className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Prepara este dispositivo para llamadas</p>
      <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">
        {state === 'blocked'
          ? 'El navegador no tiene permiso para usar el micrófono. Habilítalo en el candado de la barra de direcciones y vuelve a intentar.'
          : 'Te pedirá permiso para el micrófono y las notificaciones. Hazlo ahora para no perder la primera llamada.'}
      </p>
      <div className="mt-3 flex justify-end">
        <button type="button" onClick={prepare} disabled={state === 'working'} className="rounded-lg bg-wa-primary-strong px-3 py-2 text-xs font-semibold text-white disabled:opacity-60">
          {state === 'blocked' ? 'Reintentar' : 'Preparar'}
        </button>
      </div>
    </div>
  )
}

/** Las llamadas de WhatsApp a la vista en toda la app: la que suena y la que
 *  está en curso. En el celular ocupa el ancho, abajo, al alcance del pulgar;
 *  en la computadora, arriba a la derecha, sin tapar el chat. */
export function CallDock() {
  const { enabled, ringing, session, answer, dismiss } = useCallCenter()
  if (!enabled) return null
  const busy = session.phase === 'connecting' || session.phase === 'active'
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex flex-col gap-2 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-16 sm:p-0">
      <PrepareDevice />
      <CurrentCall />
      {ringing.map(call => (
        <IncomingCall key={call.id} call={call} busy={busy} onAnswer={() => answer(call)} onDismiss={() => dismiss(call)} />
      ))}
    </div>
  )
}
