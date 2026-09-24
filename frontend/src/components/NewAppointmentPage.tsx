import {
  CalendarClock, CalendarDays, CalendarPlus, Camera, CheckCircle2, FileText,
  FileUp, FlaskConical, History, Info, Loader2, MessageCircle, Save,
  SlidersHorizontal, UserRound, X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useMe } from '../hooks/useAuth'
import { useCustomFields } from '../hooks/useCustomFields'
import { useSellers } from '../hooks/useUsers'
import { useCreateAppointment, type AppointmentAttachmentInput, type AppointmentResult } from '../hooks/useAppointments'
import { extractErrorMessage } from '../utils/errors'
import { AppointmentCalendar } from './AppointmentCalendar'
import { AppointmentHistoryList } from './AppointmentHistoryList'
import { CameraCaptureDialog } from './CameraCaptureDialog'
import { CustomFieldInput } from './CustomFieldInput'
import { Button } from './ui/Button'
import { Input, Select, Textarea } from './ui/Input'

const tabClass = (active: boolean) =>
  `inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-wa-primary-strong ${active ? 'bg-wa-panel text-wa-primary-strong dark:bg-wa-active-dark dark:text-wa-primary' : 'text-wa-muted hover:bg-wa-hover dark:hover:bg-wa-hover-dark'}`
const fieldClass = 'h-11 border-wa-border bg-wa-field px-3 focus:ring-wa-primary-strong dark:border-wa-border-dark dark:bg-wa-field-dark'
const labelClass = 'mb-1.5 block text-sm font-medium text-wa-text dark:text-wa-text-dark'
const attachmentButtonClass = 'flex min-h-20 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-wa-border bg-wa-field/40 px-3 py-3 text-sm font-medium disabled:opacity-40 dark:border-wa-border-dark dark:bg-wa-field-dark/40'
const HOURS = Array.from({ length: 24 }, (_, hour) => [`${String(hour).padStart(2, '0')}:00`, `${String(hour).padStart(2, '0')}:30`]).flat()
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const MAX_BYTES = 10 * 1024 * 1024

const EMPTY_FORM = { nombreCompleto: '', telefono: '', servicio: '', detalle: '', fecha: '', hora: '', vendedor: '', durationMinutes: '60' }
type AppointmentForm = typeof EMPTY_FORM
type Tab = 'form' | 'calendar' | 'history'
const DRAFT_KEY = 'nueva-cita-draft-v2'

function loadDraft(): { form: AppointmentForm; customFields: Record<string, unknown> } | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return { form: { ...EMPTY_FORM, ...(parsed.form ?? parsed) }, customFields: parsed.customFields ?? {} }
  } catch { return null }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function resultMessage(result: AppointmentResult): { text: string; tone: 'success' | 'info' } {
  if (result.integrationErrors?.length) return { text: result.message ?? 'La cita se guardó, pero una integración necesita atención.', tone: 'info' }
  return { text: result.message ?? 'Cita guardada correctamente.', tone: 'success' }
}

export function NewAppointmentPage() {
  const { data: me } = useMe()
  const { data: sellers = [] } = useSellers()
  const { data: customFieldDefinitions = [] } = useCustomFields('appointment')
  const isAdmin = me?.role === 'admin'
  const [form, setForm] = useState(EMPTY_FORM)
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({})
  const [attachment, setAttachment] = useState<File | null>(null)
  const [testMode, setTestMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [result, setResult] = useState<AppointmentResult | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const [tab, setTab] = useState<Tab>('form')
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraFallbackRef = useRef<HTMLInputElement>(null)
  const createAppointment = useCreateAppointment()

  useEffect(() => {
    const draft = loadDraft()
    if (draft) { setForm(draft.form); setCustomFields(draft.customFields); setDraftRestored(true) }
  }, [])

  function update<K extends keyof AppointmentForm>(key: K, value: AppointmentForm[K]) {
    setForm(current => ({ ...current, [key]: value }))
    setResult(null)
  }

  function acceptFile(file: File) {
    setFileError(null)
    if (!ACCEPTED_TYPES.has(file.type)) return setFileError('Selecciona una imagen JPG o PNG, o un PDF.')
    if (file.size > MAX_BYTES) return setFileError('El archivo supera los 10 MB.')
    setAttachment(file)
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) acceptFile(file)
  }

  function resetForm() {
    setForm(EMPTY_FORM); setCustomFields({}); setAttachment(null); setFileError(null); setDraftRestored(false)
    localStorage.removeItem(DRAFT_KEY)
  }

  function saveDraft() {
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify({ form, customFields }))
      setDraftRestored(true); toast.success('Borrador guardado')
    } catch { toast.error('No se pudo guardar el borrador.') }
  }

  async function submit(event: FormEvent) {
    event.preventDefault(); setError(null); setResult(null)
    if (!form.nombreCompleto.trim() || !form.telefono.trim() || !form.servicio.trim() || !form.fecha || !form.hora || !form.vendedor) {
      setError('Completa los campos obligatorios.'); return
    }
    const durationMinutes = Number(form.durationMinutes)
    if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 1440) {
      setError('La duración debe estar entre 5 minutos y 24 horas.'); return
    }
    let prepared: AppointmentAttachmentInput | null = null
    if (attachment) {
      try { prepared = { contentType: attachment.type, dataBase64: await fileToBase64(attachment), filename: attachment.name } }
      catch { setError('No se pudo preparar el adjunto.'); return }
    }
    createAppointment.mutate({
      nombreCompleto: form.nombreCompleto.trim(), dni: '', telefono: form.telefono.trim(),
      tratamiento: form.servicio.trim(), detalle: form.detalle.trim(), fecha: form.fecha,
      hora: form.hora, vendedor: form.vendedor, adelanto: 0, durationMinutes,
      customFields, comprobante: prepared, testMode: isAdmin && testMode,
    }, {
      onSuccess: value => { const feedback = resultMessage(value); toast[feedback.tone](feedback.text); resetForm(); setResult(value) },
      onError: mutationError => setError(extractErrorMessage(mutationError)),
    })
  }

  const busy = createAppointment.isPending
  const feedback = result ? resultMessage(result) : null
  const title = tab === 'form' ? 'Nueva cita' : tab === 'calendar' ? 'Calendario' : 'Historial de citas'

  return (
    <main className="h-full overflow-x-hidden overflow-y-auto bg-wa-app text-wa-text dark:bg-wa-app-dark dark:text-wa-text-dark">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <header>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-wa-primary-strong"><CalendarPlus className="h-4 w-4" />Agenda del negocio</div><h1 className="text-2xl font-semibold sm:text-3xl">{title}</h1><p className="mt-2 text-sm text-wa-muted">Las reservas quedan guardadas en la app; Google Calendar y otros conectores son opcionales.</p></div>
            {isAdmin && tab === 'form' && <label className="flex min-h-11 items-center gap-3 rounded-lg border border-wa-border bg-wa-panel px-3 text-sm dark:border-wa-border-dark dark:bg-wa-panel-dark"><FlaskConical className="h-4 w-4" />Modo prueba<input type="checkbox" checked={testMode} onChange={event => setTestMode(event.target.checked)} /></label>}
          </div>
          <nav className="mt-6 flex items-center gap-1 overflow-x-auto rounded-xl bg-wa-field p-1 dark:bg-wa-field-dark" aria-label="Secciones de citas">
            <button type="button" onClick={() => setTab('form')} className={tabClass(tab === 'form')}><CalendarPlus className="h-3.5 w-3.5" />Nueva cita</button>
            <button type="button" onClick={() => setTab('calendar')} className={tabClass(tab === 'calendar')}><CalendarDays className="h-3.5 w-3.5" />Calendario</button>
            <button type="button" onClick={() => setTab('history')} className={tabClass(tab === 'history')}><History className="h-3.5 w-3.5" />Historial</button>
          </nav>
        </header>

        <div className="mt-6">
          {tab === 'calendar' ? <AppointmentCalendar /> : tab === 'history' ? <div className="rounded-xl border border-wa-border bg-wa-panel p-4 sm:p-6 dark:border-wa-border-dark dark:bg-wa-panel-dark"><AppointmentHistoryList /></div> : (
            <form onSubmit={submit} className="space-y-5">
              {draftRestored && <div className="flex items-center justify-between rounded-lg border border-wa-accent/30 bg-wa-accent/10 px-4 py-3 text-sm"><span className="flex gap-2"><FileText className="h-4 w-4" />Borrador restaurado</span><button type="button" className="font-semibold underline" onClick={resetForm}>Descartar</button></div>}
              {feedback && <div role="status" className={`rounded-lg border px-4 py-3 text-sm ${feedback.tone === 'info' ? 'border-amber-400/40 bg-amber-50 text-amber-800 dark:bg-amber-950/20 dark:text-amber-300' : 'border-green-500/30 bg-green-50 text-green-800 dark:bg-green-950/20 dark:text-green-300'}`}><CheckCircle2 className="mr-2 inline h-4 w-4" />{feedback.text}</div>}
              {error && <div role="alert" className="rounded-lg border border-red-500/30 bg-red-50 px-4 py-3 text-sm text-red-700"><Info className="mr-2 inline h-4 w-4" />{error}</div>}

              <div className="grid items-start gap-5 lg:grid-cols-2">
                <div className="space-y-5">
                  <FormSection icon={UserRound} title="Contacto" description="Datos mínimos para identificar la reserva">
                    <Field label="Nombre completo" required><Input value={form.nombreCompleto} onChange={event => update('nombreCompleto', event.target.value)} disabled={busy} className={fieldClass} /></Field>
                    <div className="mt-4"><Field label="Teléfono" required><Input type="tel" value={form.telefono} onChange={event => update('telefono', event.target.value)} disabled={busy} className={fieldClass} /></Field></div>
                  </FormSection>
                  <FormSection icon={SlidersHorizontal} title="Datos del negocio" description="Campos que un administrador configuró para sus reservas">
                    {customFieldDefinitions.length === 0 ? <p className="text-sm text-wa-muted">No hay campos adicionales configurados.</p> : <div className="grid gap-4 sm:grid-cols-2">{customFieldDefinitions.map(field => <Field key={field.id} label={field.label} required={field.required}><CustomFieldInput field={field} value={customFields[field.key]} onChange={value => setCustomFields(current => ({ ...current, [field.key]: value }))} disabled={busy} className={fieldClass} /></Field>)}</div>}
                  </FormSection>
                </div>

                <div className="space-y-5">
                  <FormSection icon={CalendarClock} title="Reserva" description="Servicio, responsable y horario">
                    <Field label="Servicio o motivo" required><Input value={form.servicio} onChange={event => update('servicio', event.target.value)} placeholder="Ej. Consulta, demo, mantenimiento" disabled={busy} className={fieldClass} /></Field>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Responsable" required><Select value={form.vendedor} onValueChange={value => update('vendedor', value)} disabled={busy} className={fieldClass}><option value="">Selecciona</option>{sellers.map(seller => <option key={seller.id} value={seller.name}>{seller.name}</option>)}</Select></Field><Field label="Duración (minutos)" required><Input type="number" min={5} max={1440} step={5} value={form.durationMinutes} onChange={event => update('durationMinutes', event.target.value)} disabled={busy} className={fieldClass} /></Field></div>
                    <div className="mt-4 grid gap-4 sm:grid-cols-2"><Field label="Fecha" required><Input type="date" value={form.fecha} onChange={event => update('fecha', event.target.value)} disabled={busy} className={fieldClass} /></Field><Field label="Hora" required><Select value={form.hora} onValueChange={value => update('hora', value)} disabled={busy} className={fieldClass}><option value="">Selecciona</option>{HOURS.map(hour => <option key={hour} value={hour}>{hour}</option>)}</Select></Field></div>
                    <div className="mt-4"><Field label="Notas"><Textarea value={form.detalle} onChange={event => update('detalle', event.target.value)} rows={3} disabled={busy} className={`${fieldClass} h-auto`} /></Field></div>
                    <p className="mt-4 flex gap-2 rounded-lg bg-wa-field px-3 py-2 text-sm text-wa-muted dark:bg-wa-field-dark"><MessageCircle className="mt-0.5 h-4 w-4 shrink-0" />La reserva se guarda aquí aunque una integración externa no esté configurada.</p>
                  </FormSection>

                  <FormSection icon={FileUp} title="Adjunto" description="Archivo de referencia opcional">
                    {attachment ? <div className="flex items-center justify-between rounded-lg bg-wa-field px-3 py-2 text-sm dark:bg-wa-field-dark"><span>{attachment.name}</span><button type="button" aria-label={`Quitar adjunto ${attachment.name}`} onClick={() => setAttachment(null)}><X className="h-4 w-4" /></button></div> : <div className="grid grid-cols-2 gap-2"><button type="button" className={attachmentButtonClass} onClick={() => fileRef.current?.click()}><FileUp className="h-4 w-4" />Subir archivo</button><button type="button" className={attachmentButtonClass} onClick={() => typeof navigator.mediaDevices?.getUserMedia === 'function' ? setIsCameraOpen(true) : cameraFallbackRef.current?.click()}><Camera className="h-4 w-4" />Tomar foto</button></div>}
                    {fileError && <p role="alert" className="mt-2 text-sm text-red-600">{fileError}</p>}
                    <input ref={fileRef} type="file" className="hidden" accept="image/jpeg,image/png,application/pdf" onChange={handleFile} /><input ref={cameraFallbackRef} type="file" className="hidden" accept="image/*" capture="environment" onChange={handleFile} />
                  </FormSection>
                </div>
              </div>

              <div className="flex flex-col-reverse gap-2 rounded-xl border border-wa-border bg-wa-panel p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark sm:flex-row sm:justify-end"><Button type="button" variant="secondary" onClick={saveDraft} disabled={busy}><Save className="h-4 w-4" />Guardar borrador</Button><Button type="submit" disabled={busy}>{busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}{busy ? 'Guardando…' : 'Guardar cita'}</Button></div>
            </form>
          )}
        </div>
      </div>
      {isCameraOpen && <CameraCaptureDialog title="Foto del adjunto" filenamePrefix="cita" cover="viewport" onCapture={file => { setIsCameraOpen(false); acceptFile(file) }} onClose={() => setIsCameraOpen(false)} />}
    </main>
  )
}

function FormSection({ icon: Icon, title, description, children }: { icon: typeof CalendarPlus; title: string; description: string; children: ReactNode }) {
  return <section className="overflow-hidden rounded-xl border border-wa-border bg-wa-panel dark:border-wa-border-dark dark:bg-wa-panel-dark"><div className="border-b border-wa-border px-4 py-4 dark:border-wa-border-dark"><div className="flex gap-3"><span className="flex h-9 w-9 items-center justify-center rounded-lg bg-wa-field text-wa-primary-strong dark:bg-wa-field-dark"><Icon className="h-4 w-4" /></span><div><h2 className="font-semibold">{title}</h2><p className="mt-1 text-sm text-wa-muted">{description}</p></div></div></div><div className="p-4">{children}</div></section>
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return <label className={labelClass}>{label}{required ? ' *' : ''}<span className="mt-1.5 block">{children}</span></label>
}
