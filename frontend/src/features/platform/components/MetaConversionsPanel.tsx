import { AlertCircle, CheckCircle2, Clock, Loader2, Megaphone, MinusCircle } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { Input } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useMetaConversions, useSaveMetaConversions } from '../hooks/useWhatsapp'
import type { MetaConversionItem, MetaConversionsUpdate } from '../types'

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

function StatusIcon({ status }: { status: MetaConversionItem['status'] }) {
  if (status === 'sent') return <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-wa-primary-strong dark:text-wa-primary" aria-hidden="true" />
  if (status === 'failed') return <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500 dark:text-red-400" aria-hidden="true" />
  if (status === 'skipped') return <MinusCircle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
  return <Clock className="h-3.5 w-3.5 shrink-0 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
}

const muted = 'text-wa-muted dark:text-wa-muted-dark'

/** API de Conversiones de Meta: cuando un cliente que llegó por un anuncio de
 *  clic a WhatsApp entra, agenda o paga el adelanto, el CRM se lo informa a
 *  Meta. Diseño: docs/analisis/14-diseno-api-conversiones-meta-ctwa.md. */
export function MetaConversionsPanel() {
  const { data, isLoading, isError } = useMetaConversions()
  const { mutate: save, isPending } = useSaveMetaConversions()
  const [accepted, setAccepted] = useState(false)
  const [testCode, setTestCode] = useState<string | null>(null)

  function submit(payload: MetaConversionsUpdate, success: string) {
    save(payload, {
      onSuccess: () => {
        toast.success(success)
        setTestCode(null)
      },
      onError: (error) => toast.error(extractErrorMessage(error)),
    })
  }

  const code = testCode ?? data?.test_event_code ?? ''

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

      {isLoading ? (
        <p className={`text-xs ${muted}`}>Cargando…</p>
      ) : isError || !data ? (
        <p className="text-xs text-red-600 dark:text-red-400">No se pudo cargar el estado de las conversiones.</p>
      ) : (
        <>
          {data.enabled ? (
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
                {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                Apagar
              </Button>
            </div>
          ) : (
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
                {isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
                Activar
              </Button>
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1">
              <label htmlFor="meta-capi-test-code" className={`text-[11px] ${muted}`}>
                Código de prueba (Administrador de eventos → Probar eventos). Mientras tenga valor, los eventos no cuentan en los informes.
              </label>
              <Input id="meta-capi-test-code" value={code} onChange={(event) => setTestCode(event.target.value)} placeholder="TEST12345" className="text-xs" />
            </div>
            <Button
              variant="secondary" size="sm"
              disabled={isPending || testCode === null || testCode === (data.test_event_code ?? '')}
              onClick={() => submit({ enabled: data.enabled, test_event_code: code }, 'Código de prueba guardado')}
            >
              Guardar código
            </Button>
          </div>

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
                  <th scope="row" className="py-1 text-left font-normal">{EVENT_LABELS[row.event_name] ?? row.event_name}</th>
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
              Último error ({EVENT_LABELS[data.last_error.event_name] ?? data.last_error.event_name}): {data.last_error.last_error}
            </p>
          )}

          {data.recent.length > 0 ? (
            <ul className="divide-y divide-wa-border text-xs dark:divide-wa-border-dark">
              {data.recent.map((item) => (
                <li key={item.id} className="flex items-start gap-2 py-1.5">
                  <StatusIcon status={item.status} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-wa-text dark:text-wa-text-dark">
                      {item.lead_name || 'Lead'} · {EVENT_LABELS[item.event_name] ?? item.event_name}
                      {item.value != null && <span className={muted}> · {item.value.toFixed(2)}{item.currency ? ` ${item.currency}` : ''}</span>}
                    </p>
                    <p className={`text-[11px] ${muted}`}>
                      {STATUS_LABELS[item.status]}
                      {item.status === 'skipped' && item.skip_reason ? `: ${item.skip_reason}` : ''} · {new Date(item.sent_at ?? item.created_at).toLocaleString()}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className={`text-xs ${muted}`}>Todavía no hay eventos de leads que llegaron por un anuncio.</p>
          )}
        </>
      )}
    </section>
  )
}
