import { CalendarClock, Camera, FileUp, NotebookPen, UserRound, Wallet, X } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { CameraCaptureDialog } from '../../../shared/ui/CameraCaptureDialog'
import { Input, Select, Textarea } from '../../../shared/ui/Input'
import { CustomFieldInput } from '../../catalogs/public/CustomFieldInput'
import { useSellers } from '../../platform/public/useUsers'
import { customKey } from '../domain/leadPrefill'
import { useBusinessCurrency } from '../hooks/useBusinessCurrency'
import { DEPOSIT_FIELD_KEY, FIELD_IDS, customErrorKey, customFieldId, type AppointmentFormState } from '../hooks/useAppointmentForm'
import { ServiceCombobox } from './ServiceCombobox'

export const fieldClass = 'h-11 border-wa-border bg-wa-field px-3 focus:ring-wa-primary-strong dark:border-wa-border-dark dark:bg-wa-field-dark'
const attachmentButtonClass = 'flex min-h-20 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-wa-border bg-wa-field/40 px-3 py-3 text-sm font-medium disabled:opacity-40 dark:border-wa-border-dark dark:bg-wa-field-dark/40'
const chipClass = 'min-h-8 rounded-full border border-wa-border px-3 text-xs font-medium text-wa-text transition-colors hover:bg-wa-hover disabled:opacity-40 dark:border-wa-border-dark dark:text-wa-text-dark dark:hover:bg-wa-hover-dark'

// La clínica no atiende de madrugada: la lista arranca a las 07:00 y las horas
// de 00:00 a 06:30 quedan al final, por si alguna vez hacen falta. Antes
// arrancaba en 00:00 y cada cita obligaba a bajar hasta la mañana.
const ALL_HOURS = Array.from({ length: 24 }, (_, hour) => [`${String(hour).padStart(2, '0')}:00`, `${String(hour).padStart(2, '0')}:30`]).flat()
const HOURS = [...ALL_HOURS.slice(14), ...ALL_HOURS.slice(0, 14)]

// Ayudas de campos personalizados conocidos. La de cualquier otro campo
// debería venir de su definición en el catálogo (pendiente: help_text).
const CUSTOM_HINTS: Record<string, string> = {
  [DEPOSIT_FIELD_KEY]: 'Monto que la clienta ya pagó para separar. Escribe 0 si aún no paga.',
  dni: '8 dígitos.',
}

type FromLead = (key: string) => boolean

interface Props {
  state: AppointmentFormState
  /** Claves que vinieron del lead: se rotulan para que el vendedor las revise. */
  prefilled?: ReadonlySet<string>
  /** El teléfono es el del lead: cambiarlo ataría la cita a otro contacto. */
  phoneLocked?: boolean
  /** Una sola columna (panel lateral) en vez de dos (página). */
  compact?: boolean
}

/**
 * Formulario de separación de cita, en el orden de la tarea: primero lo que
 * se acaba de pactar en el chat (tratamiento, fecha, hora), después el pago
 * (adelanto y su comprobante juntos), luego la clienta (casi siempre viene
 * del lead) y al final las notas.
 */
export function AppointmentFormFields({ state, prefilled, phoneLocked = false, compact = false }: Props) {
  const fromLead: FromLead = key => prefilled?.has(key) ?? false
  const booking = <BookingSection state={state} fromLead={fromLead} />
  const payment = <PaymentSection state={state} fromLead={fromLead} />
  const client = <ClientSection state={state} fromLead={fromLead} phoneLocked={phoneLocked} compact={compact} />
  const notes = <NotesSection state={state} />
  const legend = <p className="text-xs text-wa-muted">Los campos con * son obligatorios.</p>
  if (compact) return <div className="space-y-4">{legend}{booking}{payment}{client}{notes}</div>
  return (
    <div className="space-y-3">
      {legend}
      <div className="grid items-start gap-5 lg:grid-cols-2"><div className="space-y-5">{booking}{payment}</div><div className="space-y-5">{client}{notes}</div></div>
    </div>
  )
}

/** Los vendedores activos, más el responsable actual si ya no está en el
 *  equipo: un borrador viejo lo muestra hasta que se elija otro, en vez de
 *  vaciarse sin aviso. */
function useSellerNames(current: string): string[] {
  const { data: sellers = [] } = useSellers()
  const names = sellers.map(seller => seller.name)
  return current && !names.includes(current) ? [...names, current] : names
}

function isoDay(offset: number): string {
  const day = new Date()
  day.setDate(day.getDate() + offset)
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

const DATE_SHORTCUTS = [{ label: 'Hoy', offset: 0 }, { label: 'Mañana', offset: 1 }, { label: 'Pasado mañana', offset: 2 }]

function BookingSection({ state, fromLead }: { state: AppointmentFormState; fromLead: FromLead }) {
  const { form, busy, update, fieldErrors } = state
  const sellerNames = useSellerNames(form.vendedor)
  return (
    <FormSection icon={CalendarClock} title="Reserva" description="Lo que acordaste con la clienta">
      <Field id={FIELD_IDS.servicio} label="Tratamiento" required fromLead={fromLead('servicio')} hint="Busca en el catálogo o escribe el motivo." error={fieldErrors.servicio}>
        {described => <ServiceCombobox id={FIELD_IDS.servicio} value={form.servicio} onChange={value => update('servicio', value)} disabled={busy} className={fieldClass} aria-describedby={described} invalid={Boolean(fieldErrors.servicio)} />}
      </Field>
      <div className="mt-4">
        <Field id={FIELD_IDS.fecha} label="Fecha de la cita" required error={fieldErrors.fecha}>
          {described => (
            <>
              <div className="mb-2 flex flex-wrap gap-1.5" role="group" aria-label="Atajos de fecha">
                {DATE_SHORTCUTS.map(shortcut => {
                  const value = isoDay(shortcut.offset)
                  return (
                    <button key={shortcut.label} type="button" className={`${chipClass} ${form.fecha === value ? 'border-wa-primary-strong text-wa-primary-strong dark:text-wa-primary' : ''}`} aria-pressed={form.fecha === value} onClick={() => update('fecha', value)} disabled={busy}>
                      {shortcut.label}
                    </button>
                  )
                })}
              </div>
              <Input id={FIELD_IDS.fecha} type="date" value={form.fecha} onChange={event => update('fecha', event.target.value)} disabled={busy} className={fieldClass} aria-describedby={described} aria-invalid={fieldErrors.fecha ? true : undefined} />
            </>
          )}
        </Field>
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field id={FIELD_IDS.hora} label="Hora" required error={fieldErrors.hora}>
          {described => <Select id={FIELD_IDS.hora} value={form.hora} onValueChange={value => update('hora', value)} disabled={busy} className={fieldClass} aria-describedby={described} aria-invalid={fieldErrors.hora ? true : undefined}><option value="">Elige la hora</option>{HOURS.map(hour => <option key={hour} value={hour}>{hour}</option>)}</Select>}
        </Field>
        <Field id={FIELD_IDS.vendedor} label="Responsable" required fromLead={fromLead('vendedor')} hint="Quien queda a cargo de la cita." error={fieldErrors.vendedor}>
          {described => <Select id={FIELD_IDS.vendedor} value={form.vendedor} onValueChange={value => update('vendedor', value)} disabled={busy} className={fieldClass} aria-describedby={described} aria-invalid={fieldErrors.vendedor ? true : undefined}><option value="">Elige a alguien</option>{sellerNames.map(name => <option key={name} value={name}>{name}</option>)}</Select>}
        </Field>
      </div>
      {/* Casi nunca se cambia: va plegada, pero se abre sola si tiene un error. */}
      <details className="mt-4 text-sm" open={Boolean(fieldErrors.durationMinutes) || undefined}>
        <summary className="cursor-pointer text-wa-muted">Duración: {form.durationMinutes || '—'} min</summary>
        <div className="mt-2">
          <Field id={FIELD_IDS.durationMinutes} label="Duración en minutos" required hint="Cámbiala solo si el tratamiento dura otra cosa." error={fieldErrors.durationMinutes}>
            {described => <Input id={FIELD_IDS.durationMinutes} type="number" inputMode="numeric" min={5} max={1440} step={5} value={form.durationMinutes} onChange={event => update('durationMinutes', event.target.value)} disabled={busy} className={fieldClass} aria-describedby={described} aria-invalid={fieldErrors.durationMinutes ? true : undefined} />}
          </Field>
        </div>
      </details>
    </FormSection>
  )
}

/** El adelanto y el comprobante juntos: son lo que convierte la cita en venta. */
function PaymentSection({ state, fromLead }: { state: AppointmentFormState; fromLead: FromLead }) {
  const deposit = state.definitions.find(field => field.key === DEPOSIT_FIELD_KEY)
  return (
    <FormSection icon={Wallet} title="Separación" description="El adelanto y su comprobante">
      {deposit && (
        <div className="mb-4">
          <CustomField state={state} field={deposit} fromLead={fromLead} label="Adelanto pagado" placeholder="Ej. 50.00" />
        </div>
      )}
      <AttachmentField state={state} />
    </FormSection>
  )
}

function ClientSection({ state, fromLead, phoneLocked, compact }: { state: AppointmentFormState; fromLead: FromLead; phoneLocked: boolean; compact: boolean }) {
  const { form, busy, update, fieldErrors } = state
  const others = state.definitions.filter(field => field.key !== DEPOSIT_FIELD_KEY)
  return (
    <FormSection icon={UserRound} title="Clienta" description="Casi siempre viene del chat: revisa que esté bien">
      <Field id={FIELD_IDS.nombreCompleto} label="Nombre completo" required fromLead={fromLead('nombreCompleto')} hint="Como figura en su DNI." error={fieldErrors.nombreCompleto}>
        {described => <Input id={FIELD_IDS.nombreCompleto} value={form.nombreCompleto} onChange={event => update('nombreCompleto', event.target.value)} disabled={busy} className={fieldClass} autoComplete="off" aria-describedby={described} aria-invalid={fieldErrors.nombreCompleto ? true : undefined} />}
      </Field>
      <div className="mt-4">
        <Field
          id={FIELD_IDS.telefono}
          label="Teléfono"
          required
          fromLead={fromLead('telefono')}
          hint={phoneLocked ? 'Es el número del chat: la cita queda en su ficha.' : 'Con código de país, ej. 51 987 654 321.'}
          error={fieldErrors.telefono}
        >
          {described => <Input id={FIELD_IDS.telefono} type="tel" inputMode="tel" value={form.telefono} onChange={event => update('telefono', event.target.value)} disabled={busy} readOnly={phoneLocked} className={`${fieldClass} ${phoneLocked ? 'cursor-not-allowed opacity-80' : ''}`} aria-describedby={described} aria-invalid={fieldErrors.telefono ? true : undefined} />}
        </Field>
      </div>
      <CustomFieldsBody state={state} fields={others} fromLead={fromLead} compact={compact} />
    </FormSection>
  )
}

function CustomFieldsBody({ state, fields, fromLead, compact }: { state: AppointmentFormState; fields: AppointmentFormState['definitions']; fromLead: FromLead; compact: boolean }) {
  if (state.customFieldsLoading) return <p className="mt-4 text-sm text-wa-muted">Cargando campos…</p>
  if (state.customFieldsError) return <p className="mt-4 text-sm text-red-600 dark:text-red-400">No se pudieron cargar los campos. <button type="button" className="font-semibold underline" onClick={() => state.refetchCustomFields()}>Reintentar</button></p>
  if (fields.length === 0) return null
  return (
    <div className={`mt-4 grid gap-4 ${compact ? '' : 'sm:grid-cols-2'}`}>
      {fields.map(field => <CustomField key={field.id} state={state} field={field} fromLead={fromLead} />)}
    </div>
  )
}

function CustomField({ state, field, fromLead, label, placeholder }: {
  state: AppointmentFormState
  field: AppointmentFormState['definitions'][number]
  fromLead: FromLead
  label?: string
  placeholder?: string
}) {
  const currency = useBusinessCurrency()
  const error = state.fieldErrors[customErrorKey(field.key)]
  return (
    <Field id={customFieldId(field.key)} label={label ?? field.label} required={field.required} fromLead={fromLead(customKey(field.key))} hint={CUSTOM_HINTS[field.key]} error={error}>
      {described => (
        <CustomFieldInput
          field={field}
          value={state.customFields[field.key]}
          onChange={value => state.setCustomField(field.key, value)}
          disabled={state.busy}
          className={fieldClass}
          currency={field.key === DEPOSIT_FIELD_KEY ? currency : undefined}
          describedBy={described}
          invalid={Boolean(error)}
          placeholder={placeholder}
        />
      )}
    </Field>
  )
}

function NotesSection({ state }: { state: AppointmentFormState }) {
  const { form, busy, update } = state
  return (
    <FormSection icon={NotebookPen} title="Notas" description="Para el equipo que la atiende">
      <Field id={FIELD_IDS.detalle} label="Notas para la clínica" hint="Alergias, zona a tratar o lo que conviene saber antes de la cita.">
        {described => <Textarea id={FIELD_IDS.detalle} value={form.detalle} onChange={event => update('detalle', event.target.value)} rows={3} disabled={busy} className={`${fieldClass} h-auto`} aria-describedby={described} />}
      </Field>
    </FormSection>
  )
}

function AttachmentField({ state }: { state: AppointmentFormState }) {
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraFallbackRef = useRef<HTMLInputElement>(null)

  function openCamera() {
    if (typeof navigator.mediaDevices?.getUserMedia === 'function') setIsCameraOpen(true)
    else cameraFallbackRef.current?.click()
  }

  return (
    <div>
      <p className="mb-1 text-sm font-medium text-wa-text dark:text-wa-text-dark">Comprobante del adelanto</p>
      <p id="appointment-receipt-hint" className="mb-2 text-xs text-wa-muted">Foto o captura del Yape, Plin o transferencia. JPG, PNG o PDF, hasta 10 MB.</p>
      {state.attachment
        ? <div className="flex items-center justify-between gap-2 rounded-lg bg-wa-field px-3 py-2 text-sm dark:bg-wa-field-dark"><span className="min-w-0 truncate">{state.attachment.name}</span><button type="button" aria-label={`Quitar comprobante ${state.attachment.name}`} onClick={state.removeAttachment} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md hover:bg-wa-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary-strong dark:hover:bg-wa-hover-dark"><X className="h-4 w-4" /></button></div>
        : <div className="grid grid-cols-2 gap-2"><button type="button" className={attachmentButtonClass} aria-describedby="appointment-receipt-hint" onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4" />Subir archivo</button><button type="button" className={attachmentButtonClass} aria-describedby="appointment-receipt-hint" onClick={openCamera}><Camera className="h-4 w-4" />Tomar foto</button></div>}
      {state.fileError && <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">{state.fileError}</p>}
      <input ref={fileRef} type="file" className="hidden" accept="image/jpeg,image/png,application/pdf" onChange={state.handleFile} /><input ref={cameraFallbackRef} type="file" className="hidden" accept="image/*" capture="environment" onChange={state.handleFile} />
      {isCameraOpen && <CameraCaptureDialog title="Foto del comprobante" filenamePrefix="cita" cover="viewport" onCapture={file => { setIsCameraOpen(false); state.acceptFile(file) }} onClose={() => setIsCameraOpen(false)} />}
    </div>
  )
}

function LeadMark() {
  return <span className="rounded-full bg-wa-accent/15 px-2 py-0.5 text-[11px] font-semibold text-wa-primary-strong dark:text-wa-primary">Del lead</span>
}

function FormSection({ icon: Icon, title, description, children }: { icon: typeof CalendarClock; title: string; description: string; children: ReactNode }) {
  return <section className="overflow-hidden rounded-xl border border-wa-border bg-wa-panel dark:border-wa-border-dark dark:bg-wa-panel-dark"><div className="border-b border-wa-border px-4 py-4 dark:border-wa-border-dark"><div className="flex gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-wa-field text-wa-primary-strong dark:bg-wa-field-dark"><Icon className="h-4 w-4" /></span><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm text-wa-muted">{description}</p></div></div></div><div className="p-4">{children}</div></section>
}

/**
 * Etiqueta, ayuda y error de un campo. La etiqueta apunta al control por `id`
 * (no lo envuelve: un clic en la lista de un buscador no debe reenviarse al
 * campo) y la ayuda y el error se anuncian con `aria-describedby`.
 */
function Field({ id, label, required, fromLead, hint, error, children }: {
  id: string
  label: string
  required?: boolean
  fromLead?: boolean
  hint?: string
  error?: string
  children: (describedBy: string | undefined) => ReactNode
}) {
  const hintId = hint ? `${id}-hint` : undefined
  const errorId = error ? `${id}-error` : undefined
  const describedBy = [errorId, hintId].filter(Boolean).join(' ') || undefined
  return (
    <div className="text-sm font-medium text-wa-text dark:text-wa-text-dark">
      <label htmlFor={id} className="mb-1.5 flex items-center gap-2">{label}{required ? ' *' : ''}{fromLead && <LeadMark />}</label>
      {children(describedBy)}
      {error && <p id={errorId} className="mt-1.5 text-xs font-medium text-red-600 dark:text-red-400">{error}</p>}
      {hint && <p id={hintId} className="mt-1.5 text-xs font-normal text-wa-muted">{hint}</p>}
    </div>
  )
}
