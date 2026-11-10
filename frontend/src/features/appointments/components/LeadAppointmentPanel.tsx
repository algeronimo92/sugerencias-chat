import { ArrowLeft, CalendarPlus, Check, Info, Loader2, UserRoundCheck, X } from 'lucide-react'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { DialogPrimitive, dialogOverlayClassOverPanel } from '../../../shared/ui/Dialog'
import type { LeadCorrection, LeadSnapshot } from '../domain/leadPrefill'
import { submitLabel } from '../domain/submitLabel'
import { DEPOSIT_FIELD_KEY } from '../hooks/useAppointmentForm'
import { useBusinessCurrency } from '../hooks/useBusinessCurrency'
import { useLeadAppointment, type LeadAppointmentState } from '../hooks/useLeadAppointment'
import { AppointmentFormFields } from './AppointmentFormFields'

interface Props {
  lead: LeadSnapshot
  /** Los valores de los campos del negocio del lead ya llegaron. */
  leadReady: boolean
  onClose: () => void
}

const iconButtonClass ='rounded-lg p-1.5 hover:bg-wa-hover dark:hover:bg-wa-hover-dark'

/**
 * Separar cita desde el chat o la ficha del lead, en un panel que se desliza desde la
 * derecha: el chat queda a la vista para copiar la fecha u hora que dijo el
 * cliente. En móvil ocupa toda la pantalla.
 */
export function LeadAppointmentPanel({ lead, leadReady, onClose }: Props) {
  const flow = useLeadAppointment(lead, leadReady, onClose)
  const busy = flow.state.busy

  return (
    <DialogPrimitive.Root open onOpenChange={open => { if (!open && !busy) onClose() }}>
      <DialogPrimitive.Portal>
        {/* En móvil se abre desde el cajón de sugerencias (z-76) y debe
            taparlo, igual que a la barra inferior y su hoja "Más" (z-86). */}
        <DialogPrimitive.Overlay className={dialogOverlayClassOverPanel} />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-[88] flex w-full flex-col pt-safe bg-wa-app text-wa-text shadow-2xl outline-none sm:w-[min(32rem,100vw)] sm:border-l sm:border-wa-border dark:bg-wa-app-dark dark:text-wa-text-dark dark:sm:border-wa-border-dark"
        >
          <PanelHeader lead={lead} flow={flow} />
          <form onSubmit={flow.handleSubmit} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              {flow.state.error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/20 dark:text-red-300"><Info className="mr-2 inline h-4 w-4" />{flow.state.error}</div>}
              <PanelBody lead={lead} flow={flow} />
            </div>
            <PanelFooter flow={flow} />
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function PanelHeader({ lead, flow }: { lead: LeadSnapshot; flow: LeadAppointmentState }) {
  const reviewing = flow.corrections !== null
  return (
    <header className="flex items-center gap-3 border-b border-wa-border bg-wa-panel px-4 py-3 dark:border-wa-border-dark dark:bg-wa-panel-dark">
      {reviewing
        ? <button type="button" aria-label="Volver al formulario" className={iconButtonClass} onClick={flow.backToForm} disabled={flow.state.busy}><ArrowLeft className="h-4 w-4" /></button>
        : <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-wa-field text-wa-primary-strong dark:bg-wa-field-dark"><CalendarPlus className="h-4 w-4" /></span>}
      <div className="min-w-0 flex-1">
        <DialogPrimitive.Title className="font-semibold">{reviewing ? 'Actualizar el lead' : 'Separar cita'}</DialogPrimitive.Title>
        <p className="truncate text-xs text-wa-muted">{lead.name || lead.phone || 'Lead sin nombre'}</p>
      </div>
      <DialogPrimitive.Close asChild><button type="button" aria-label="Cerrar" className={iconButtonClass} disabled={flow.state.busy}><X className="h-4 w-4" /></button></DialogPrimitive.Close>
    </header>
  )
}

function PanelBody({ lead, flow }: { lead: LeadSnapshot; flow: LeadAppointmentState }) {
  if (!flow.ready) return <p className="flex items-center gap-2 text-sm text-wa-muted"><Loader2 className="h-4 w-4 animate-spin" />Cargando los datos del lead…</p>
  if (flow.corrections !== null) return <CorrectionsStep corrections={flow.corrections} chosen={flow.chosen} onToggle={flow.toggle} disabled={flow.state.busy} />
  return <AppointmentFormFields state={flow.state} prefilled={flow.prefilled} phoneLocked={Boolean(lead.phone)} compact />
}

function PanelFooter({ flow }: { flow: LeadAppointmentState }) {
  const { state } = flow
  const currency = useBusinessCurrency()
  const editing = flow.corrections === null
  return (
    <footer className="space-y-3 border-t border-wa-border bg-wa-panel px-4 pt-4 pb-safe-3 dark:border-wa-border-dark dark:bg-wa-panel-dark">
      {editing && flow.needsConfirmation && flow.ready && (
        <label className="flex items-start gap-2.5 text-sm">
          <Checkbox className="mt-0.5" checked={flow.confirmed} onCheckedChange={flow.setConfirmed} disabled={state.busy} />
          <span>Confirmo que los datos tomados del lead son correctos</span>
        </label>
      )}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        {editing && state.hasDraft && <DraftStatus disabled={state.busy} onDiscard={flow.discardDraft} />}
        <Button type="submit" disabled={!flow.canSave}>
          {state.busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
          {state.busy ? 'Guardando…' : submitLabel(state.customFields[DEPOSIT_FIELD_KEY], currency, state.definitions.some(field => field.key === DEPOSIT_FIELD_KEY))}
        </Button>
      </div>
    </footer>
  )
}

/** El borrador se guarda solo; esto avisa que existe y permite volver a los
 *  datos del lead. */
function DraftStatus({ disabled, onDiscard }: { disabled: boolean; onDiscard: () => void }) {
  return (
    <p className="flex items-center justify-center gap-1.5 text-xs text-wa-muted sm:mr-auto">
      <Check className="h-3.5 w-3.5" aria-hidden="true" />
      Borrador guardado
      <button type="button" className="font-semibold underline" onClick={onDiscard} disabled={disabled}>Descartar</button>
    </p>
  )
}

function display(value: unknown): string {
  if (value === null || value === undefined || value === '') return 'Sin dato'
  if (typeof value === 'boolean') return value ? 'Sí' : 'No'
  return String(value)
}

function CorrectionsStep({ corrections, chosen, onToggle, disabled }: {
  corrections: LeadCorrection[]
  chosen: ReadonlySet<string>
  onToggle: (key: string, checked: boolean) => void
  disabled: boolean
}) {
  return (
    <section className="space-y-3">
      <div className="flex gap-3 rounded-xl border border-wa-border bg-wa-panel p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark">
        <UserRoundCheck className="mt-0.5 h-5 w-5 shrink-0 text-wa-primary-strong" />
        <p className="text-sm">Cambiaste datos que vinieron del lead. Marca los que quieres actualizar también en su ficha; los demás quedan solo en la cita.</p>
      </div>
      <ul className="space-y-2">
        {corrections.map(correction => (
          <li key={correction.key}>
            <label className="flex items-start gap-3 rounded-lg border border-wa-border bg-wa-panel px-3 py-2.5 text-sm dark:border-wa-border-dark dark:bg-wa-panel-dark">
              <Checkbox className="mt-0.5" checked={chosen.has(correction.key)} onCheckedChange={checked => onToggle(correction.key, checked)} disabled={disabled} />
              <span className="min-w-0">
                <span className="block font-medium">{correction.label}</span>
                <span className="block text-wa-muted"><s>{display(correction.from)}</s> <span aria-hidden="true">→</span><span className="sr-only">pasa a</span> <span className="text-wa-text dark:text-wa-text-dark">{display(correction.to)}</span></span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  )
}
