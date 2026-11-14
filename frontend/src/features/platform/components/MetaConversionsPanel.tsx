import { AlertCircle, CheckCircle2, Clock, Loader2, Megaphone, MinusCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { Input } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useMetaConversions, useSaveMetaConversions } from '../hooks/useWhatsapp'
import type { MetaConversionItem, MetaConversionsStatus, MetaConversionsUpdate } from '../types'

const TERMS_URL = 'https://www.facebook.com/legal/commercial_terms'

// Los tres eventos que la política de datos enumera.
const EVENT_LABELS: Record<string, string> = {
  LeadSubmitted: 'Lead desde un anuncio',
  QualifiedLead: 'Lead calificado (primera cita)',
  Purchase: 'Compra (adelanto de la cita)',
}

const STATUS_LABELS: Record<MetaConversionItem['status'], string> = {
  sent: 'Enviado a Meta',
  pending: 'En cola',
  skipped: 'Omitido',
  failed: 'No se pudo enviar',
}

const STATUS_ICONS: Record<MetaConversionItem['status'], { Icon: typeof Clock; className: string }> = {
  sent: { Icon: CheckCircle2, className: 'text-wa-primary-strong dark:text-wa-primary' },
  failed: { Icon: AlertCircle, className: 'text-red-500 dark:text-red-400' },
  skipped: { Icon: MinusCircle, className: 'text-amber-600 dark:text-amber-400' },
  pending: { Icon: Clock, className: 'text-wa-muted dark:text-wa-muted-dark' },
}

const muted = 'text-wa-muted dark:text-wa-muted-dark'

type Submit = (payload: MetaConversionsUpdate, success: string, onSuccess?: () => void) => void

function eventLabel(name: string) {
  return EVENT_LABELS[name] ?? name
}

function StatusIcon({ status }: { status: MetaConversionItem['status'] }) {
  const { Icon, className } = STATUS_ICONS[status]
  return <Icon className={`h-3.5 w-3.5 shrink-0 ${className}`} aria-hidden="true" />
}

function PendingSpinner({ show }: { show: boolean }) {
  return show ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null
}

/** Encendido: quién aceptó las condiciones y cómo apagarlo. */
function EnabledControls({ data, submit, isPending }: { data: MetaConversionsStatus; submit: Submit; isPending: boolean }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-xs text-wa-text dark:text-wa-text-dark">
        Activo{data.dataset_id && <span className={muted}> · dataset {data.dataset_id}</span>}
        {data.accepted_by && data.accepted_at && (
          <span className={`block text-[11px] ${muted}`}>
            Condiciones aceptadas por {data.accepted_by} el {new Date(data.accepted_at).toLocaleString()}
          </span>
        )}
      </p>
      <Button variant="secondary" size="sm" disabled={isPending} onClick={() => submit({ enabled: false }, 'Envío a Meta apagado')}>
        <PendingSpinner show={isPending} />
        Apagar
      </Button>
    </div>
  )
}

/** Apagado: encender exige aceptar las Condiciones de Meta (lo promete la política de datos). */
function DisabledControls({ submit, isPending }: { submit: Submit; isPending: boolean }) {
  const [accepted, setAccepted] = useState(false)
  return (
    <div className="space-y-2 rounded-md bg-wa-field/60 p-2 dark:bg-wa-field-dark/60">
      <p className="text-xs text-wa-text dark:text-wa-text-dark">Apagado: no se informa nada a Meta.</p>
      <label className="flex items-start gap-2 text-xs text-wa-text dark:text-wa-text-dark">
        <Checkbox checked={accepted} onCheckedChange={setAccepted} aria-label="Aceptar las condiciones" />
        <span>
          Acepto las{' '}
          <a href={TERMS_URL} target="_blank" rel="noreferrer" className="font-medium text-wa-primary-strong underline dark:text-wa-primary">
            Condiciones de las herramientas comerciales de Meta
          </a>{' '}
          en nombre de la clínica.
        </span>
      </label>
      <Button size="sm" disabled={!accepted || isPending} onClick={() => submit({ enabled: true, accept_terms: true }, 'Los eventos de anuncios se informarán a Meta')}>
        <PendingSpinner show={isPending} />
        Activar
      </Button>
    </div>
  )
}

function TestCodeField({ data, submit, isPending }: { data: MetaConversionsStatus; submit: Submit; isPending: boolean }) {
  const saved = data.test_event_code ?? ''
  const [code, setCode] = useState<string | null>(null)
  const value = code ?? saved
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1">
        <label htmlFor="meta-capi-test-code" className={`text-[11px] ${muted}`}>
          Código de prueba (Administrador de eventos → Probar eventos). Mientras tenga valor, los eventos no cuentan en los informes.
        </label>
        <Input id="meta-capi-test-code" value={value} onChange={(event) => setCode(event.target.value)} placeholder="TEST12345" className="text-xs" />
      </div>
      <Button
        variant="secondary" size="sm"
        disabled={isPending || code === null || code === saved}
        onClick={() => submit({ enabled: data.enabled, test_event_code: value }, 'Código de prueba guardado', () => setCode(null))}
      >
        Guardar código
      </Button>
    </div>
  )
}

function CountsTable({ data }: { data: MetaConversionsStatus }) {
  return (
    <>
      <table className="w-full text-xs">
        <caption className={`mb-1 text-left text-[11px] ${muted}`}>Últimos {data.days} días</caption>
        <thead>
          <tr className={`text-left text-[11px] ${muted}`}>
            <th scope="col" className="py-1 font-medium">Evento</th>
            <th scope="col" className="py-1 text-right font-medium">Enviados</th>
            <th scope="col" className="py-1 text-right font-medium">En cola</th>
            <th scope="col" className="py-1 text-right font-medium">Omitidos</th>
            <th scope="col" className="py-1 text-right font-medium">Con error</th>
          </tr>
        </thead>
        <tbody className="text-wa-text dark:text-wa-text-dark">
          {data.events.map((row) => (
            <tr key={row.event_name} className="border-t border-wa-border dark:border-wa-border-dark">
              <th scope="row" className="py-1 text-left font-normal">{eventLabel(row.event_name)}</th>
              <td className="py-1 text-right tabular-nums">{row.sent}</td>
              <td className="py-1 text-right tabular-nums">{row.pending}</td>
              <td className="py-1 text-right tabular-nums">{row.skipped}</td>
              <td className="py-1 text-right tabular-nums">{row.failed}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className={`text-[11px] ${muted}`}>
        {data.leads_with_click} de {data.leads_total} leads del período llegaron con el identificador de un anuncio. Meta no
        lo manda en todos los casos (por ejemplo, en anuncios de Estados).
      </p>
      {data.last_error && (
        <p className="break-words text-[11px] text-red-600 dark:text-red-400">
          Último error ({eventLabel(data.last_error.event_name)}): {data.last_error.last_error}
        </p>
      )}
    </>
  )
}

function RecentItem({ item }: { item: MetaConversionItem }) {
  const amount = item.value == null ? '' : ` · ${item.value.toFixed(2)}${item.currency ? ` ${item.currency}` : ''}`
  const reason = item.status === 'skipped' && item.skip_reason ? `: ${item.skip_reason}` : ''
  return (
    <li className="flex items-start gap-2 py-1.5">
      <StatusIcon status={item.status} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-wa-text dark:text-wa-text-dark">
          {item.lead_name || 'Lead'} · {eventLabel(item.event_name)}
          <span className={muted}>{amount}</span>
        </p>
        <p className={`text-[11px] ${muted}`}>
          {STATUS_LABELS[item.status]}{reason} · {new Date(item.sent_at ?? item.created_at).toLocaleString()}
        </p>
      </div>
    </li>
  )
}

function RecentList({ items }: { items: MetaConversionItem[] }) {
  if (items.length === 0) {
    return <p className={`text-xs ${muted}`}>Todavía no hay eventos de leads que llegaron por un anuncio.</p>
  }
  return (
    <ul className="divide-y divide-wa-border text-xs dark:divide-wa-border-dark">
      {items.map((item) => <RecentItem key={item.id} item={item} />)}
    </ul>
  )
}

function ConversionsBody({ data }: { data: MetaConversionsStatus }) {
  const { mutate: save, isPending } = useSaveMetaConversions()
  const submit: Submit = (payload, success, onSuccess) => {
    save(payload, {
      onSuccess: () => {
        toast.success(success)
        onSuccess?.()
      },
      onError: (error) => toast.error(extractErrorMessage(error)),
    })
  }
  return (
    <>
      {data.enabled
        ? <EnabledControls data={data} submit={submit} isPending={isPending} />
        : <DisabledControls submit={submit} isPending={isPending} />}
      <TestCodeField data={data} submit={submit} isPending={isPending} />
      <CountsTable data={data} />
      <RecentList items={data.recent} />
    </>
  )
}

/** API de Conversiones de Meta: cuando un cliente que llegó por un anuncio de
 *  clic a WhatsApp entra, agenda o paga el adelanto, el CRM se lo informa a
 *  Meta. Diseño: docs/analisis/14-diseno-api-conversiones-meta-ctwa.md. */
export function MetaConversionsPanel() {
  const { data, isLoading, isError } = useMetaConversions()
  let body
  if (isLoading) body = <p className={`text-xs ${muted}`}>Cargando…</p>
  else if (isError || !data) body = <p className="text-xs text-red-600 dark:text-red-400">No se pudo cargar el estado de las conversiones.</p>
  else body = <ConversionsBody data={data} />

  return (
    <section className="space-y-3 rounded-lg border border-wa-border p-3 dark:border-wa-border-dark">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-wa-text dark:text-wa-text-dark">
        <Megaphone className="h-4 w-4" aria-hidden="true" />
        Conversiones de anuncios (Meta)
      </h3>
      <p className={`text-[11px] ${muted}`}>
        Cuando un cliente escribe desde un anuncio de clic a WhatsApp, agenda su primera cita o paga el adelanto, se le
        informa a Meta solo con el identificador del clic y, en la compra, el monto y la moneda. Nunca viajan el teléfono,
        el nombre ni el tratamiento. Así la campaña aprende qué anuncios traen citas y ventas.
      </p>
      {body}
    </section>
  )
}
