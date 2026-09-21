import {
  CalendarClock,
  CalendarPlus,
  Camera,
  CheckCircle2,
  CreditCard,
  FileText,
  FileUp,
  FlaskConical,
  History,
  Info,
  Loader2,
  MessageCircle,
  Save,
  Stethoscope,
  UserRound,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { toast } from 'sonner'
import { useMe } from '../hooks/useAuth'
import { useSellers } from '../hooks/useUsers'
import { useCreateAppointment, type AppointmentAttachmentInput, type AppointmentResult } from '../hooks/useAppointments'
import { extractErrorMessage } from '../utils/errors'
import { AppointmentHistoryList } from './AppointmentHistoryList'
import { CameraCaptureDialog } from './CameraCaptureDialog'
import { Button } from './ui/Button'
import { Input, Select, Textarea } from './ui/Input'

const tabClass = (active: boolean) =>
  `inline-flex min-h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-wa-primary-strong focus-visible:ring-offset-2 ${
    active
      ? 'bg-wa-panel text-wa-primary-strong dark:bg-wa-active-dark dark:text-wa-primary'
      : 'text-wa-muted hover:bg-wa-hover hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark dark:hover:text-wa-text-dark'
  }`

const appointmentFieldClass = 'h-11 border-wa-border bg-wa-field px-3 focus:ring-wa-primary-strong dark:border-wa-border-dark dark:bg-wa-field-dark'
const appointmentLabelClass = 'mb-1.5 block text-sm font-medium text-wa-text dark:text-wa-text-dark'
const comprobanteButtonClass =
  'flex min-h-24 w-full flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-wa-border bg-wa-field/40 px-3 py-4 text-center text-sm font-medium text-wa-text hover:border-wa-primary-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong disabled:opacity-40 dark:border-wa-border-dark dark:bg-wa-field-dark/40 dark:text-wa-text-dark'

const TRATAMIENTOS = [
  'Hollywood Peel x1',
  'Hollywood Peel x3',
  'Hifu12D',
  'Limpieza Facial',
  'AC Tranexamico',
  'Botox',
  'Bioestimuladores',
  'ADN de Salmon',
  'ADN con Exosomas',
  'AC Hialuronico',
  'Hilos Tensores',
  'Tatuaje',
  'Enzimas',
  'Plasma Rico en Plaquetas',
  'Depilacion',
  'Retiro de Lunares',
  'Consulta',
]

const HORAS = [
  '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30',
  '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
]

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const MAX_BYTES = 10 * 1024 * 1024

const EMPTY_FORM = {
  nombreCompleto: '',
  dni: '',
  telefono: '',
  tratamiento: '',
  detalle: '',
  fecha: '',
  hora: '',
  vendedor: '',
  adelanto: '0',
}

type AppointmentForm = typeof EMPTY_FORM

// El comprobante (File) no se guarda: no se puede serializar a JSON, así que
// el borrador solo recuerda los campos de texto y hay que volver a adjuntarlo.
const DRAFT_KEY = 'nueva-cita-draft'

function loadDraft(): AppointmentForm | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    return { ...EMPTY_FORM, ...JSON.parse(raw) }
  } catch {
    return null
  }
}

function saveDraft(form: AppointmentForm): boolean {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(form))
    return true
  } catch {
    return false
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY)
  } catch {
    // Idem: si falla, no hay nada más que hacer.
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function resultMessage(result: AppointmentResult): { text: string; tone: 'success' | 'error' | 'info' } {
  if (result.citaDuplicada) {
    return { text: 'Esta cita ya estaba registrada, no se creó de nuevo.', tone: 'info' }
  }
  if (result.message) {
    return { text: result.message, tone: result.success === false ? 'error' : 'success' }
  }
  if (result.success === false) {
    return { text: 'La cita se registró con errores. Revisa el historial antes de intentarlo de nuevo.', tone: 'error' }
  }
  return { text: 'Cita enviada correctamente.', tone: 'success' }
}

export function NewAppointmentPage() {
  const { data: me } = useMe()
  const { data: sellers = [] } = useSellers()
  const isAdmin = me?.role === 'admin'
  const [form, setForm] = useState(EMPTY_FORM)
  const [comprobante, setComprobante] = useState<File | null>(null)
  const [testMode, setTestMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [result, setResult] = useState<AppointmentResult | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const [tab, setTab] = useState<'form' | 'history'>('form')
  const [isCameraOpen, setIsCameraOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const cameraFallbackRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const resultRef = useRef<HTMLDivElement>(null)
  const createAppointment = useCreateAppointment()

  useEffect(() => {
    const draft = loadDraft()
    if (draft) {
      setForm(draft)
      setDraftRestored(true)
    }
  }, [])

  useEffect(() => {
    if (error) errorRef.current?.focus()
  }, [error])

  useEffect(() => {
    if (result) resultRef.current?.focus()
  }, [result])

  function update<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm(current => ({ ...current, [key]: value }))
    setResult(null)
  }

  // Misma validación venga del disco o de la cámara: la foto tomada acá es un
  // JPEG, así que pasa por el mismo filtro de tipo y tamaño.
  function acceptFile(file: File) {
    setFileError(null)
    if (!ACCEPTED_TYPES.has(file.type)) {
      setFileError('Selecciona una imagen JPG o PNG, o un PDF.')
      return
    }
    if (file.size > MAX_BYTES) {
      setFileError('El archivo supera los 10 MB. Elige uno más pequeño.')
      return
    }
    setComprobante(file)
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''
    setFileError(null)
    if (!file) return
    acceptFile(file)
  }

  function handleOpenCamera() {
    setFileError(null)
    // `mediaDevices` no existe fuera de un contexto seguro, aunque los tipos
    // del DOM lo den siempre por presente. Sin él queda el input con
    // `capture`, que en el celular abre la cámara nativa.
    const mediaDevices = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
    if (mediaDevices && typeof mediaDevices.getUserMedia === 'function') {
      setIsCameraOpen(true)
      return
    }
    cameraFallbackRef.current?.click()
  }

  function handleCameraCaptured(file: File) {
    setIsCameraOpen(false)
    acceptFile(file)
  }

  function resetForm() {
    setForm(EMPTY_FORM)
    setComprobante(null)
    setDraftRestored(false)
    setFileError(null)
    setResult(null)
    clearDraft()
  }

  function handleSaveDraft() {
    if (!saveDraft(form)) {
      toast.error('No se pudo guardar el borrador. Inténtalo de nuevo.')
      return
    }
    setDraftRestored(true)
    toast.success('Borrador guardado')
  }

  function discardDraft() {
    resetForm()
    toast.info('Borrador descartado')
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setResult(null)

    if (!form.nombreCompleto.trim() || !form.telefono.trim() || !form.tratamiento || !form.fecha || !form.hora || !form.vendedor) {
      setError('Completa los campos obligatorios.')
      return
    }
    const adelanto = Number(form.adelanto)
    if (!Number.isFinite(adelanto) || adelanto < 0) {
      setError('El adelanto debe ser un número mayor o igual a 0.')
      return
    }

    let attachment: AppointmentAttachmentInput | null = null
    if (comprobante) {
      try {
        attachment = {
          contentType: comprobante.type,
          dataBase64: await fileToBase64(comprobante),
          filename: comprobante.name,
        }
      } catch {
        setError('No se pudo preparar el comprobante para el envío.')
        return
      }
    }

    createAppointment.mutate({
      nombreCompleto: form.nombreCompleto.trim(),
      dni: form.dni.trim(),
      telefono: form.telefono.trim(),
      tratamiento: form.tratamiento,
      detalle: form.detalle.trim(),
      fecha: form.fecha,
      hora: form.hora,
      vendedor: form.vendedor,
      adelanto,
      comprobante: attachment,
      testMode: isAdmin && testMode,
    }, {
      onSuccess: result => {
        const { text, tone } = resultMessage(result)
        toast[tone](text)
        if (tone === 'success') resetForm()
        setResult(result)
      },
      onError: mutationError => setError(extractErrorMessage(mutationError)),
    })
  }

  const busy = createAppointment.isPending
  const resultFeedback = result ? resultMessage(result) : null

  return (
    <main className="h-full overflow-x-hidden overflow-y-auto bg-wa-app text-wa-text dark:bg-wa-app-dark dark:text-wa-text-dark">
      <div className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <header>
          <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-wa-primary-strong dark:text-wa-primary">
                <CalendarPlus className="h-4 w-4" aria-hidden="true" />
                Agenda comercial
              </div>
              <h1 className="text-2xl font-semibold text-wa-text dark:text-wa-text-dark sm:text-3xl">{tab === 'form' ? 'Nueva cita' : 'Historial de citas'}</h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
                {tab === 'form' ? 'Completa los datos para solicitar la cita y enviar la confirmación por WhatsApp.' : 'Consulta las citas registradas y revisa el resultado de cada envío.'}
              </p>
            </div>
            {isAdmin && tab === 'form' && (
              <label className={`flex min-h-11 shrink-0 cursor-pointer items-center gap-3 rounded-lg border px-3 text-sm font-medium ${testMode ? 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300' : 'border-wa-border bg-wa-panel text-wa-text dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark'}`}>
                <FlaskConical className="h-4 w-4" aria-hidden="true" />
                Modo prueba
                <input type="checkbox" checked={testMode} onChange={e => setTestMode(e.target.checked)} className="peer sr-only" />
                <span aria-hidden="true" className={`relative h-5 w-9 rounded-full peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-wa-primary-strong ${testMode ? 'bg-amber-600' : 'bg-wa-muted dark:bg-wa-muted-dark'}`}>
                  <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white motion-safe:transition-transform ${testMode ? 'translate-x-[18px]' : 'translate-x-0.5'}`} />
                </span>
              </label>
            )}
          </div>

          <div className="mt-6 border-b border-wa-border pb-3 dark:border-wa-border-dark">
            <nav className="flex items-center gap-1 rounded-xl bg-wa-field p-1 dark:bg-wa-field-dark" aria-label="Secciones de citas">
              <button type="button" onClick={() => setTab('form')} aria-pressed={tab === 'form'} className={tabClass(tab === 'form')}>
                <CalendarPlus className="h-3.5 w-3.5" aria-hidden="true" /> Nueva cita
              </button>
              <button type="button" onClick={() => setTab('history')} aria-pressed={tab === 'history'} className={tabClass(tab === 'history')}>
                <History className="h-3.5 w-3.5" aria-hidden="true" /> Historial
              </button>
            </nav>
          </div>
        </header>

        {isAdmin && testMode && tab === 'form' && (
          <div className="mt-4 flex items-start gap-2.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300" role="status">
            <FlaskConical className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span><strong>Modo prueba activo.</strong> La cita se enviará al entorno de prueba. Revisa el resultado antes de considerarla confirmada.</span>
          </div>
        )}

        <div className="mt-6">
          {tab === 'history' ? (
            <div className="rounded-xl border border-wa-border bg-wa-panel p-4 sm:p-6 dark:border-wa-border-dark dark:bg-wa-panel-dark">
              <AppointmentHistoryList />
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-5">
              {draftRestored && (
                <div className="flex flex-col gap-3 rounded-lg border border-wa-accent/30 bg-wa-accent/10 px-4 py-3 text-sm text-blue-800 sm:flex-row sm:items-center sm:justify-between dark:text-wa-accent" role="status">
                  <span className="flex items-start gap-2"><FileText className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span><strong>Borrador disponible.</strong> El comprobante no se guarda con los datos; tendrás que volver a adjuntarlo si sales de esta página.</span></span>
                  <button type="button" onClick={discardDraft} disabled={busy} className="min-h-9 shrink-0 self-start rounded px-2 font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong disabled:opacity-40 sm:self-auto">Descartar y limpiar</button>
                </div>
              )}

              {resultFeedback && (
                <div ref={resultRef} tabIndex={-1} role={resultFeedback.tone === 'error' ? 'alert' : 'status'} className={`flex flex-col gap-2 rounded-lg border px-4 py-3 text-sm outline-none focus-visible:ring-2 sm:flex-row sm:items-center sm:justify-between ${resultFeedback.tone === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-700 focus-visible:ring-red-600 dark:text-red-300' : resultFeedback.tone === 'info' ? 'border-wa-accent/30 bg-wa-accent/10 text-blue-800 focus-visible:ring-wa-accent dark:text-wa-accent' : 'border-green-600/30 bg-green-500/10 text-green-800 focus-visible:ring-green-700 dark:text-green-300'}`}>
                  <span className="flex items-start gap-2">{resultFeedback.tone === 'success' ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}<span>{resultFeedback.text}{resultFeedback.tone === 'error' && ' Conservamos los datos del formulario.'}</span></span>
                  <button type="button" onClick={() => setTab('history')} className="min-h-9 shrink-0 self-start rounded px-2 font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong">Ver historial</button>
                </div>
              )}

              {error && (
                <div ref={errorRef} tabIndex={-1} role="alert" className="flex items-start gap-2.5 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-medium text-red-700 outline-none focus-visible:ring-2 focus-visible:ring-red-600 dark:text-red-300">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}
                </div>
              )}

              <div className="grid items-start gap-5 lg:grid-cols-[1.08fr_0.92fr]">
                <div className="space-y-5">
                  <FormSection icon={UserRound} title="Datos del cliente" description="Información para identificar y contactar al paciente">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="sm:col-span-2">
                        <label htmlFor="nc-nombre" className={appointmentLabelClass}>Nombre completo *</label>
                        <Input id="nc-nombre" value={form.nombreCompleto} onChange={e => update('nombreCompleto', e.target.value)} placeholder="Nombre y apellidos del cliente" disabled={busy} required className={appointmentFieldClass} />
                      </div>
                      <div>
                        <label htmlFor="nc-dni" className={appointmentLabelClass}>DNI <span className="font-normal text-wa-muted dark:text-wa-muted-dark">· Opcional</span></label>
                        <Input id="nc-dni" inputMode="numeric" autoComplete="off" value={form.dni} onChange={e => update('dni', e.target.value)} placeholder="8 dígitos" disabled={busy} className={appointmentFieldClass} />
                      </div>
                      <div>
                        <label htmlFor="nc-telefono" className={appointmentLabelClass}>Teléfono *</label>
                        <Input id="nc-telefono" type="tel" inputMode="tel" autoComplete="off" value={form.telefono} onChange={e => update('telefono', e.target.value)} placeholder="999 999 999" disabled={busy} required className={appointmentFieldClass} />
                      </div>
                    </div>
                  </FormSection>

                  <FormSection icon={Stethoscope} title="Servicio y atención" description="Tratamiento solicitado y responsable comercial">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label htmlFor="nc-tratamiento" className={appointmentLabelClass}>Tratamiento *</label>
                        <Select id="nc-tratamiento" value={form.tratamiento} onValueChange={value => update('tratamiento', value)} disabled={busy} required className={appointmentFieldClass}>
                          <option value="" disabled>Selecciona un tratamiento</option>
                          {TRATAMIENTOS.map(item => <option key={item} value={item}>{item}</option>)}
                        </Select>
                      </div>
                      <div>
                        <label htmlFor="nc-vendedor" className={appointmentLabelClass}>Vendedor *</label>
                        <Select id="nc-vendedor" value={form.vendedor} onValueChange={value => update('vendedor', value)} disabled={busy} required className={appointmentFieldClass}>
                          <option value="" disabled>Selecciona un vendedor</option>
                          {sellers.map(seller => <option key={seller.id} value={seller.name}>{seller.name}</option>)}
                        </Select>
                      </div>
                      <div className="sm:col-span-2">
                        <label htmlFor="nc-detalle" className={appointmentLabelClass}>Detalle <span className="font-normal text-wa-muted dark:text-wa-muted-dark">· Opcional</span></label>
                        <Textarea id="nc-detalle" value={form.detalle} onChange={e => update('detalle', e.target.value)} rows={3} placeholder="Zona, precio, sesión o paquete acordado" disabled={busy} className={`${appointmentFieldClass} h-auto min-h-24 resize-none py-3`} />
                      </div>
                    </div>
                  </FormSection>
                </div>

                <div className="space-y-5">
                  <FormSection icon={CalendarClock} title="Fecha y hora" description="Momento reservado para la atención">
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                      <div>
                        <label htmlFor="nc-fecha" className={appointmentLabelClass}>Fecha *</label>
                        <Input id="nc-fecha" type="date" value={form.fecha} onChange={e => update('fecha', e.target.value)} disabled={busy} required className={appointmentFieldClass} />
                      </div>
                      <div>
                        <label htmlFor="nc-hora" className={appointmentLabelClass}>Hora *</label>
                        <Select id="nc-hora" value={form.hora} onValueChange={value => update('hora', value)} disabled={busy} required className={appointmentFieldClass}>
                          <option value="" disabled>Selecciona una hora</option>
                          {HORAS.map(item => <option key={item} value={item}>{item}</option>)}
                        </Select>
                      </div>
                    </div>
                    <div className="mt-4 flex items-start gap-2 rounded-lg bg-wa-field px-3 py-2.5 text-sm leading-5 text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark">
                      <MessageCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-wa-primary" aria-hidden="true" />
                      Al registrar, se intentará crear el evento y enviar la confirmación por WhatsApp. Revisa el resultado.
                    </div>
                  </FormSection>

                  <FormSection icon={CreditCard} title="Pago y comprobante" description="Adelanto recibido y respaldo de la operación">
                    <div>
                      <label htmlFor="nc-adelanto" className={appointmentLabelClass}>Adelanto</label>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2 text-sm font-semibold text-wa-muted dark:text-wa-muted-dark">S/</span>
                        <Input id="nc-adelanto" type="number" min={0} step="0.01" value={form.adelanto} onChange={e => update('adelanto', e.target.value)} placeholder="0.00" disabled={busy} className={`${appointmentFieldClass} pl-10`} />
                      </div>
                    </div>

                    <div className="mt-4">
                      <p className={appointmentLabelClass}>Comprobante <span className="font-normal text-wa-muted dark:text-wa-muted-dark">· Opcional</span></p>
                      {comprobante ? (
                        <div className="flex items-center justify-between gap-3 rounded-lg border border-wa-border bg-wa-field px-3 py-2 text-sm text-wa-text dark:border-wa-border-dark dark:bg-wa-field-dark dark:text-wa-text-dark">
                          <span className="flex min-w-0 items-center gap-2"><CheckCircle2 className="h-4 w-4 shrink-0 text-wa-primary" aria-hidden="true" /><span className="truncate">{comprobante.name}</span></span>
                          <button type="button" onClick={() => { setComprobante(null); setFileError(null) }} disabled={busy} aria-label={`Quitar comprobante ${comprobante.name}`} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-wa-muted hover:bg-wa-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong disabled:opacity-40 dark:hover:bg-wa-hover-dark"><X className="h-4 w-4" aria-hidden="true" /></button>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 gap-2">
                          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} aria-invalid={Boolean(fileError)} aria-describedby={fileError ? 'nc-comprobante-help nc-comprobante-error' : 'nc-comprobante-help'} className={comprobanteButtonClass}>
                            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-wa-field text-wa-primary-strong dark:bg-wa-field-dark dark:text-wa-primary"><FileUp className="h-4 w-4" aria-hidden="true" /></span>
                            <span>Subir archivo</span>
                          </button>
                          <button type="button" onClick={handleOpenCamera} disabled={busy} aria-describedby="nc-comprobante-help" className={comprobanteButtonClass}>
                            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-wa-field text-wa-primary-strong dark:bg-wa-field-dark dark:text-wa-primary"><Camera className="h-4 w-4" aria-hidden="true" /></span>
                            <span>Tomar foto</span>
                          </button>
                        </div>
                      )}
                      <p id="nc-comprobante-help" className="mt-1.5 text-xs text-wa-muted dark:text-wa-muted-dark">JPG, PNG o PDF · máximo 10 MB</p>
                      {fileError && <p id="nc-comprobante-error" role="alert" className="mt-1.5 text-sm text-red-700 dark:text-red-300">{fileError}</p>}
                      <input ref={fileRef} type="file" tabIndex={-1} aria-hidden="true" accept="image/jpeg,image/png,application/pdf" onChange={handleFile} className="hidden" />
                      {/* Solo para navegadores sin getUserMedia: `capture` le pide
                          al sistema la cámara en vez del explorador de archivos. */}
                      <input ref={cameraFallbackRef} type="file" tabIndex={-1} aria-hidden="true" accept="image/*" capture="environment" onChange={handleFile} className="hidden" />
                    </div>
                  </FormSection>
                </div>
              </div>

              <div className="flex flex-col gap-4 rounded-xl border border-wa-border bg-wa-panel p-4 sm:flex-row sm:items-center sm:justify-between dark:border-wa-border-dark dark:bg-wa-panel-dark">
                <div className="flex items-start gap-2 text-sm leading-5 text-wa-muted dark:text-wa-muted-dark">
                  <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Revisa los datos antes de registrar. Los campos con * son obligatorios.</span>
                </div>
                <div className="flex shrink-0 flex-col-reverse gap-2 sm:flex-row">
                  <Button type="button" variant="secondary" onClick={handleSaveDraft} disabled={busy} className="h-11 px-4">
                    <Save className="h-4 w-4" aria-hidden="true" /> Guardar borrador
                  </Button>
                  <Button type="submit" disabled={busy} className="h-11 bg-wa-primary-strong px-5 hover:bg-wa-primary-deep">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <CalendarPlus className="h-4 w-4" aria-hidden="true" />}
                    {busy ? 'Registrando…' : 'Registrar cita'}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>

      {isCameraOpen && (
        <CameraCaptureDialog
          title="Foto del comprobante"
          filenamePrefix="comprobante"
          cover="viewport"
          onCapture={handleCameraCaptured}
          onClose={() => setIsCameraOpen(false)}
        />
      )}
    </main>
  )
}

function FormSection({ icon: Icon, title, description, children }: { icon: typeof CalendarPlus; title: string; description: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-wa-border bg-wa-panel dark:border-wa-border-dark dark:bg-wa-panel-dark">
      <div className="border-b border-wa-border px-4 py-4 dark:border-wa-border-dark sm:px-5">
        <div className="flex items-start gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-wa-field text-wa-primary-strong dark:bg-wa-field-dark dark:text-wa-primary"><Icon className="h-4 w-4" aria-hidden="true" /></span>
          <div><h2 className="text-base font-semibold text-wa-text dark:text-wa-text-dark">{title}</h2><p className="mt-1 text-sm leading-5 text-wa-muted dark:text-wa-muted-dark">{description}</p></div>
        </div>
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  )
}
