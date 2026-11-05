import { CalendarClock, CalendarPlus, Camera, FileUp, MessageCircle, SlidersHorizontal, UserRound, X } from 'lucide-react'
import { useRef, useState, type ReactNode } from 'react'
import { CameraCaptureDialog } from '../../../shared/ui/CameraCaptureDialog'
import { Input, Select, Textarea } from '../../../shared/ui/Input'
import { CustomFieldInput } from '../../catalogs/public/CustomFieldInput'
import { useSellers } from '../../platform/public/useUsers'
import { customKey } from '../domain/leadPrefill'
import type { AppointmentFormState } from '../hooks/useAppointmentForm'
import { ServiceCombobox } from './ServiceCombobox'

export const fieldClass = 'h-11 border-wa-border bg-wa-field px-3 focus:ring-wa-primary-strong dark:border-wa-border-dark dark:bg-wa-field-dark'
const labelClass = 'mb-1.5 flex items-center gap-2 text-sm font-medium text-wa-text dark:text-wa-text-dark'
const attachmentButtonClass = 'flex min-h-20 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-wa-border bg-wa-field/40 px-3 py-3 text-sm font-medium disabled:opacity-40 dark:border-wa-border-dark dark:bg-wa-field-dark/40'
const HOURS = Array.from({ length: 24 }, (_, hour) => [`${String(hour).padStart(2, '0')}:00`, `${String(hour).padStart(2, '0')}:30`]).flat()

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

export function AppointmentFormFields({ state, prefilled, phoneLocked = false, compact = false }: Props) {
  const fromLead: FromLead = key => prefilled?.has(key) ?? false
  const contact = <ContactSection state={state} fromLead={fromLead} phoneLocked={phoneLocked} />
  const business = <BusinessFieldsSection state={state} fromLead={fromLead} compact={compact} />
  const booking = <BookingSection state={state} fromLead={fromLead} compact={compact} />
  const attachment = <AttachmentSection state={state} />
  if (compact) return <div className="space-y-4">{contact}{booking}{business}{attachment}</div>
  return <div className="grid items-start gap-5 lg:grid-cols-2"><div className="space-y-5">{contact}{business}</div><div className="space-y-5">{booking}{attachment}</div></div>
}

function ContactSection({ state, fromLead, phoneLocked }: { state: AppointmentFormState; fromLead: FromLead; phoneLocked: boolean }) {
  const { form, busy, update } = state
  return (
    <FormSection icon={UserRound} title="Contacto" description="Datos mínimos para identificar la reserva">
      <Field label="Nombre completo" required fromLead={fromLead('nombreCompleto')}><Input value={form.nombreCompleto} onChange={event => update('nombreCompleto', event.target.value)} disabled={busy} className={fieldClass} /></Field>
      <div className="mt-4"><Field label="Teléfono" required fromLead={fromLead('telefono')}><Input type="tel" value={form.telefono} onChange={event => update('telefono', event.target.value)} disabled={busy} readOnly={phoneLocked} className={`${fieldClass} ${phoneLocked ? 'cursor-not-allowed opacity-80' : ''}`} /></Field></div>
      {phoneLocked && <p className="mt-1.5 text-xs text-wa-muted">Es el número del lead; la cita queda en su ficha.</p>}
    </FormSection>
  )
}

function BusinessFieldsSection({ state, fromLead, compact }: { state: AppointmentFormState; fromLead: FromLead; compact: boolean }) {
  return (
    <FormSection icon={SlidersHorizontal} title="Datos del negocio" description="Campos que un administrador configuró para sus reservas">
      <BusinessFieldsBody state={state} fromLead={fromLead} compact={compact} />
    </FormSection>
  )
}

function BusinessFieldsBody({ state, fromLead, compact }: { state: AppointmentFormState; fromLead: FromLead; compact: boolean }) {
  if (state.customFieldsLoading) return <p className="text-sm text-wa-muted">Cargando campos…</p>
  if (state.customFieldsError) return <p className="text-sm text-red-600 dark:text-red-400">No se pudieron cargar los campos. <button type="button" className="font-semibold underline" onClick={() => state.refetchCustomFields()}>Reintentar</button></p>
  if (state.definitions.length === 0) return <p className="text-sm text-wa-muted">No hay campos adicionales configurados.</p>
  return (
    <div className={`grid gap-4 ${compact ? '' : 'sm:grid-cols-2'}`}>
      {state.definitions.map(field => (
        <Field key={field.id} label={field.label} required={field.required} fromLead={fromLead(customKey(field.key))}>
          <CustomFieldInput field={field} value={state.customFields[field.key]} onChange={value => state.setCustomField(field.key, value)} disabled={state.busy} className={fieldClass} />
        </Field>
      ))}
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

function BookingSection({ state, fromLead, compact }: { state: AppointmentFormState; fromLead: FromLead; compact: boolean }) {
  const { form, busy, update } = state
  const sellerNames = useSellerNames(form.vendedor)
  return (
    <FormSection icon={CalendarClock} title="Reserva" description="Servicio, responsable y horario">
      {/* Fuera de <label>: un clic en la lista no debe reenviarse al campo. */}
      <div><label htmlFor="appointment-service" className={labelClass}>Servicio o motivo *{fromLead('servicio') && <LeadMark />}</label><ServiceCombobox id="appointment-service" value={form.servicio} onChange={value => update('servicio', value)} disabled={busy} className={fieldClass} /></div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Responsable" required fromLead={fromLead('vendedor')}><Select value={form.vendedor} onValueChange={value => update('vendedor', value)} disabled={busy} className={fieldClass}><option value="">Selecciona</option>{sellerNames.map(name => <option key={name} value={name}>{name}</option>)}</Select></Field><Field label="Duración (minutos)" required><Input type="number" min={5} max={1440} step={5} value={form.durationMinutes} onChange={event => update('durationMinutes', event.target.value)} disabled={busy} className={fieldClass} /></Field></div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Fecha" required><Input type="date" value={form.fecha} onChange={event => update('fecha', event.target.value)} disabled={busy} className={fieldClass} /></Field><Field label="Hora" required><Select value={form.hora} onValueChange={value => update('hora', value)} disabled={busy} className={fieldClass}><option value="">Selecciona</option>{HOURS.map(hour => <option key={hour} value={hour}>{hour}</option>)}</Select></Field></div>
      <div className="mt-4"><Field label="Notas"><Textarea value={form.detalle} onChange={event => update('detalle', event.target.value)} rows={3} disabled={busy} className={`${fieldClass} h-auto`} /></Field></div>
      {!compact && <p className="mt-4 flex gap-2 rounded-lg bg-wa-field px-3 py-2 text-sm text-wa-muted dark:bg-wa-field-dark"><MessageCircle className="mt-0.5 h-4 w-4 shrink-0" />La reserva se guarda aquí aunque una integración externa no esté configurada.</p>}
    </FormSection>
  )
}

function AttachmentSection({ state }: { state: AppointmentFormState }) {
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraFallbackRef = useRef<HTMLInputElement>(null)

  function openCamera() {
    if (typeof navigator.mediaDevices?.getUserMedia === 'function') setIsCameraOpen(true)
    else cameraFallbackRef.current?.click()
  }

  return (
    <FormSection icon={FileUp} title="Adjunto" description="Archivo de referencia opcional">
      {state.attachment
        ? <div className="flex items-center justify-between rounded-lg bg-wa-field px-3 py-2 text-sm dark:bg-wa-field-dark"><span className="min-w-0 truncate">{state.attachment.name}</span><button type="button" aria-label={`Quitar adjunto ${state.attachment.name}`} onClick={state.removeAttachment}><X className="h-4 w-4" /></button></div>
        : <div className="grid grid-cols-2 gap-2"><button type="button" className={attachmentButtonClass} onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4" />Subir archivo</button><button type="button" className={attachmentButtonClass} onClick={openCamera}><Camera className="h-4 w-4" />Tomar foto</button></div>}
      {state.fileError && <p role="alert" className="mt-2 text-sm text-red-600">{state.fileError}</p>}
      <input ref={fileRef} type="file" className="hidden" accept="image/jpeg,image/png,application/pdf" onChange={state.handleFile} /><input ref={cameraFallbackRef} type="file" className="hidden" accept="image/*" capture="environment" onChange={state.handleFile} />
      {isCameraOpen && <CameraCaptureDialog title="Foto del adjunto" filenamePrefix="cita" cover="viewport" onCapture={file => { setIsCameraOpen(false); state.acceptFile(file) }} onClose={() => setIsCameraOpen(false)} />}
    </FormSection>
  )
}

function LeadMark() {
  return <span className="rounded-full bg-wa-accent/15 px-2 py-0.5 text-[11px] font-semibold text-wa-primary-strong dark:text-wa-primary">Del lead</span>
}

function FormSection({ icon: Icon, title, description, children }: { icon: typeof CalendarPlus; title: string; description: string; children: ReactNode }) {
  return <section className="overflow-hidden rounded-xl border border-wa-border bg-wa-panel dark:border-wa-border-dark dark:bg-wa-panel-dark"><div className="border-b border-wa-border px-4 py-4 dark:border-wa-border-dark"><div className="flex gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-wa-field text-wa-primary-strong dark:bg-wa-field-dark"><Icon className="h-4 w-4" /></span><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm text-wa-muted">{description}</p></div></div></div><div className="p-4">{children}</div></section>
}

function Field({ label, required, fromLead, children }: { label: string; required?: boolean; fromLead?: boolean; children: ReactNode }) {
  return <label className="block text-sm font-medium text-wa-text dark:text-wa-text-dark"><span className="mb-1.5 flex items-center gap-2">{label}{required ? ' *' : ''}{fromLead && <LeadMark />}</span><span className="block">{children}</span></label>
}
