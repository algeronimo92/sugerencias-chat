import { AlertTriangle, CheckCircle2, Clock3, Loader2, MessageCircle, PauseCircle, RotateCcw, UserX } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useCancelExecution, useDismissExecution, useResumeExecution, useRetryExecution } from '../queries'
import type { AutomationExecution } from '../types'
import { ATTENTION_WINDOW_DAYS, attentionCount, type AttentionCause, type AttentionGroup } from '../utils/attention'
import { formatExecutionDate, readableExecutionError } from '../utils/automationExecutions'

const CAUSE_ICON: Record<AttentionCause, LucideIcon> = {
  service_window: Clock3,
  failed: AlertTriangle,
  no_seller: UserX,
  long_pause: PauseCircle,
}

const ACTION = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line-control bg-surface px-3 text-xs font-semibold text-fg outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50'
const QUIET_ACTION = 'inline-flex min-h-9 items-center rounded-lg px-2.5 text-xs font-semibold text-fg-muted outline-none transition-colors hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50'
const PRIMARY_ACTION = 'inline-flex min-h-9 items-center gap-1.5 rounded-lg bg-accent-fill px-3 text-xs font-semibold text-on-accent outline-none transition-colors hover:bg-[color-mix(in_srgb,var(--accent-fill),#000_8%)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-wait disabled:opacity-50'

interface Props {
  groups: AttentionGroup[]
  isLoading: boolean
  onOpenChat: (leadId: string | null) => void
  onSeeActivity: () => void
}

/**
 * Lo que no salió como debía y espera una decisión, agrupado por causa y con
 * el arreglo en la misma fila.
 *
 * Antes solo se encontraba filtrando el historial por «Fallida», y un fallo
 * de madrugada pasaba sin que nadie lo viera: la pantalla abría con tres
 * contadores que no pedían ninguna acción.
 */
export function AttentionPanel({ groups, isLoading, onOpenChat, onSeeActivity }: Props) {
  const retry = useRetryExecution()
  const resume = useResumeExecution()
  const cancel = useCancelExecution()
  const dismiss = useDismissExecution()
  const busy = retry.isPending || resume.isPending || cancel.isPending || dismiss.isPending
  const fail = (error: Error) => toast.error(extractErrorMessage(error))

  if (isLoading) {
    return <div className="flex justify-center py-20"><Loader2 className="h-6 w-6 animate-spin text-fg-muted" aria-label="Cargando" /></div>
  }
  if (attentionCount(groups) === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-line bg-surface px-6 py-16 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-accent-strong" aria-hidden="true" />
        <p className="mt-3 text-sm font-semibold text-fg">Todo en marcha</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-fg-muted">
          Ninguna automatización falló en los últimos {ATTENTION_WINDOW_DAYS} días ni quedó olvidada en pausa.
        </p>
        <button type="button" onClick={onSeeActivity} className={`${ACTION} mt-4`}>Ver la actividad</button>
      </div>
    )
  }

  function actions(cause: AttentionCause, execution: AutomationExecution) {
    const chat = execution.lead_id && (
      <button type="button" onClick={() => onOpenChat(execution.lead_id)} className={ACTION}>
        <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />Ir al chat
      </button>
    )
    if (cause === 'long_pause') {
      return (
        <>
          <button
            type="button" disabled={busy} className={PRIMARY_ACTION}
            onClick={() => resume.mutate(execution.id, { onSuccess: () => toast.success('Automatización reanudada'), onError: fail })}
          >Reanudar</button>
          <ConfirmDialog
            title="Cancelar esta ejecución"
            description={`«${execution.rule_name}» dejará de correr para ${execution.lead_name ?? 'este lead'} y no enviará los pasos que faltan. No se puede deshacer.`}
            confirmLabel="Cancelar ejecución" cancelLabel="No cancelar" disabled={busy}
            onConfirm={() => cancel.mutate(execution.id, { onSuccess: () => toast.success('Ejecución cancelada'), onError: fail })}
          >
            <button type="button" disabled={busy} className={ACTION}>Cancelar</button>
          </ConfirmDialog>
          {chat}
        </>
      )
    }
    if (cause === 'service_window') {
      return (
        <>
          {chat}
          <ConfirmDialog
            title="Enviar con la ventana de 24 h cerrada"
            description="El flujo retomará desde el paso que falló y enviará sus mensajes aunque el cliente no haya escrito en las últimas 24 h. WhatsApp puede rechazarlos o cobrarlos. Queda registrado que lo autorizaste."
            confirmLabel="Autorizar y reintentar" disabled={busy}
            onConfirm={() => retry.mutate({ id: execution.id, ignoreServiceWindow: true }, { onSuccess: () => toast.success('Ejecución reprogramada'), onError: fail })}
          >
            <button type="button" disabled={busy} className={ACTION}>Autorizar y reintentar</button>
          </ConfirmDialog>
        </>
      )
    }
    return (
      <>
        <button
          type="button" disabled={busy} className={cause === 'failed' ? PRIMARY_ACTION : ACTION}
          onClick={() => retry.mutate({ id: execution.id }, { onSuccess: () => toast.success('Ejecución reprogramada'), onError: fail })}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />Reintentar
        </button>
        {chat}
      </>
    )
  }

  return (
    <div className="space-y-4">
      {groups.map(group => {
        const Icon = CAUSE_ICON[group.cause]
        return (
          <section key={group.cause} aria-labelledby={`atender-${group.cause}`} className="overflow-hidden rounded-2xl border border-line bg-surface">
            <header className="flex flex-wrap items-start gap-x-3 gap-y-1 border-b border-line px-4 py-3">
              <Icon className="mt-0.5 h-4 w-4 shrink-0 text-danger-fg" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <h2 id={`atender-${group.cause}`} className="text-sm font-semibold text-fg">
                  {group.title} <span className="font-normal text-fg-muted">· {group.executions.length}</span>
                </h2>
                <p className="mt-0.5 text-sm text-fg-muted">{group.hint}</p>
              </div>
            </header>
            <ul className="divide-y divide-line">
              {group.executions.map(execution => (
                <li key={execution.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="truncate text-sm font-medium text-fg">
                      {execution.lead_name ?? 'Lead sin nombre'} <span className="font-normal text-fg-muted">· {execution.rule_name}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-fg-muted">
                      {group.cause === 'long_pause'
                        ? `En pausa desde ${formatExecutionDate(execution.paused_at)}`
                        : `${formatExecutionDate(execution.finished_at ?? execution.created_at)}${group.cause === 'failed' && execution.error ? ` · ${readableExecutionError(execution.error)}` : ''}`}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {actions(group.cause, execution)}
                    {/* Sin esto la lista no se vaciaba nunca: hay fallos con los
                        que no hay nada que hacer (el cliente ya fue atendido a mano). */}
                    <button
                      type="button" disabled={busy} className={QUIET_ACTION}
                      aria-label={`Descartar el aviso de ${execution.lead_name ?? 'este lead'}`}
                      onClick={() => dismiss.mutate(execution.id, { onSuccess: () => toast.success('Aviso descartado'), onError: fail })}
                    >Descartar</button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )
      })}
      <p className="text-xs text-fg-muted">
        Se muestran los fallos de los últimos {ATTENTION_WINDOW_DAYS} días. «Descartar» quita el aviso sin tocar la ejecución; lo anterior y lo descartado están en{' '}
        <button type="button" onClick={onSeeActivity} className="font-semibold text-accent-strong underline">Actividad</button>.
      </p>
    </div>
  )
}
