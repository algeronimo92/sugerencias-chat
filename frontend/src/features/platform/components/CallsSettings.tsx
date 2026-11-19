import { AlertTriangle, CheckCircle2, HelpCircle, Loader2, PhoneCall, RefreshCw } from 'lucide-react'
import { Button } from '../../../shared/ui/Button'
import { MIGRATION_CHANGES, canReceiveCallsPermission, messagingLimitLabel, readinessCopy, type ReadinessTone } from '../callingReadiness'
import { useUsers } from '../hooks/useUsers'
import { useCallingReadiness } from '../hooks/useWhatsapp'
import type { CallingReadiness } from '../types'
import { CallsActivation } from './CallsActivation'
import { UserCallsSwitch } from './UserCallsSwitch'

const muted = 'text-wa-muted dark:text-wa-muted-dark'

const TONE: Record<ReadinessTone, { box: string; icon: typeof CheckCircle2 }> = {
  ok: { box: 'border-green-200 bg-green-50/70 text-green-900 dark:border-green-900/60 dark:bg-green-950/20 dark:text-green-100', icon: CheckCircle2 },
  action: { box: 'border-amber-200 bg-amber-50/70 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100', icon: AlertTriangle },
  unknown: { box: 'border-wa-border bg-wa-field/60 text-wa-text dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark', icon: HelpCircle },
}

function ReadinessNotice({ readiness, onRetry, retrying }: { readiness: CallingReadiness; onRetry: () => void; retrying: boolean }) {
  const copy = readinessCopy(readiness)
  const { box, icon: Icon } = TONE[copy.tone]
  const limit = messagingLimitLabel(readiness.messaging_limit)
  return (
    <div role="status" className={`space-y-2 rounded-lg border p-3 text-xs leading-5 ${box}`}>
      <p className="flex items-start gap-2 font-semibold">
        <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        {copy.title}
      </p>
      <p>{copy.body}</p>
      {readiness.state === 'requires_migration' && (
        <>
          <p className="font-medium">Qué cambia al mudarlo:</p>
          <ul className="list-disc space-y-1 pl-5">
            {MIGRATION_CHANGES.map((change) => <li key={change}>{change}</li>)}
          </ul>
          <p className="font-medium">El cambio no se puede deshacer: antes de hacerlo, coordínalo con el equipo de CliniVentas.</p>
        </>
      )}
      {limit && readiness.state !== 'limit_too_low' && (
        <p className={muted}>Límite de mensajes de la cuenta: {limit} por día.</p>
      )}
      {readiness.state === 'unverified' && (
        <Button variant="secondary" size="sm" disabled={retrying} onClick={onRetry}>
          <RefreshCw className={`h-3.5 w-3.5 ${retrying ? 'animate-spin' : ''}`} aria-hidden="true" />
          Volver a consultar
        </Button>
      )}
    </div>
  )
}

function Readiness() {
  const { data, isLoading, isError, refetch, isFetching } = useCallingReadiness()
  if (isLoading) {
    return (
      <p role="status" className={`flex items-center gap-2 text-xs ${muted}`}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Consultando a Meta…
      </p>
    )
  }
  if (isError || !data) {
    // Nunca un estado "apagado" que parezca definitivo: no se sabe.
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
        No pudimos consultar el estado en Meta.
        <Button variant="secondary" size="sm" disabled={isFetching} onClick={() => refetch()}>Reintentar</Button>
      </div>
    )
  }
  return <ReadinessNotice readiness={data} onRetry={() => refetch()} retrying={isFetching} />
}

/** Activar solo se ofrece con el número listo: en cualquier otro estado Meta lo rechazaría. */
function Activation() {
  const { data } = useCallingReadiness()
  return data?.state === 'ready' ? <CallsActivation /> : null
}

function Agents() {
  const { data: users, isLoading, isError } = useUsers(true)
  const candidates = (users ?? []).filter(canReceiveCallsPermission).sort((a, b) => a.name.localeCompare(b.name))
  const answering = candidates.filter((user) => user.can_handle_calls).length
  return (
    <div className="space-y-2">
      <div>
        <h4 className="text-xs font-semibold text-wa-text dark:text-wa-text-dark">Quiénes atienden</h4>
        <p className={`text-[11px] ${muted}`}>
          {answering === 0
            ? 'Nadie todavía. A quienes elijas les sonarán las llamadas y podrán llamar a clientes.'
            : `${answering} ${answering === 1 ? 'persona atiende' : 'personas atienden'}. Les suenan las llamadas a todas a la vez; atiende la primera.`}
        </p>
      </div>
      {isLoading && <p className={`text-xs ${muted}`}>Cargando el equipo…</p>}
      {isError && <p role="alert" className="text-xs text-red-600 dark:text-red-400">No se pudo cargar el equipo.</p>}
      <ul className="divide-y divide-wa-border rounded-lg border border-wa-border dark:divide-wa-border-dark dark:border-wa-border-dark">
        {candidates.map((user) => (
          <li key={user.id} className="flex flex-wrap items-center justify-between gap-x-3 px-3 py-1">
            <span className="min-w-0 truncate text-sm text-wa-text dark:text-wa-text-dark">
              {user.name}
              {user.invitation_pending && <span className={`ml-1 text-[11px] ${muted}`}>(invitación pendiente)</span>}
            </span>
            <UserCallsSwitch user={user} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/** Llamadas de WhatsApp: si el número puede activarlas y quiénes atienden.
 *  Plan: docs/analisis/17-plan-llamadas-whatsapp.md (fase 1). */
export function CallsSettings() {
  return (
    <section aria-labelledby="calls-settings-title" className="space-y-3 rounded-lg border border-wa-border p-3 dark:border-wa-border-dark">
      <h3 id="calls-settings-title" className="flex items-center gap-2 text-sm font-semibold text-wa-text dark:text-wa-text-dark">
        <PhoneCall className="h-4 w-4" aria-hidden="true" />
        Llamadas de WhatsApp
      </h3>
      <p className={`text-[11px] ${muted}`}>
        Atender las llamadas de tus clientes desde el CRM, en la computadora o el celular, y que quede registrado en el chat.
      </p>
      <Readiness />
      <Agents />
      <Activation />
    </section>
  )
}
