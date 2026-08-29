import { CalendarPlus, FileText, FileUp, FlaskConical, Loader2, Save, X } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useMe } from '../hooks/useAuth'
import { useCreateAppointment, type AppointmentAttachmentInput, type AppointmentResult } from '../hooks/useAppointments'
import { extractErrorMessage } from '../utils/errors'
import { Button } from './ui/Button'
import { Input, Select, Textarea, labelClass } from './ui/Input'

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

const VENDEDORES = ['Antonella', 'Grecia']

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

function saveDraft(form: AppointmentForm) {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(form))
  } catch {
    // Modo privado, cuota llena, etc. — el borrador no es crítico, se ignora.
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
  return { text: 'Cita enviada correctamente.', tone: 'success' }
}

export function NewAppointmentPage() {
  const { data: me } = useMe()
  const isAdmin = me?.role === 'admin'
  const [form, setForm] = useState(EMPTY_FORM)
  const [comprobante, setComprobante] = useState<File | null>(null)
  const [testMode, setTestMode] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftRestored, setDraftRestored] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const createAppointment = useCreateAppointment()

  useEffect(() => {
    const draft = loadDraft()
    if (draft) {
      setForm(draft)
      setDraftRestored(true)
    }
  }, [])

  function update<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm(current => ({ ...current, [key]: value }))
  }

  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null
    event.target.value = ''
    setError(null)
    if (!file) return
    if (!ACCEPTED_TYPES.has(file.type)) {
      setError('El comprobante debe ser una imagen JPG/PNG o un PDF.')
      return
    }
    if (file.size > MAX_BYTES) {
      setError('El comprobante supera el máximo de 10 MB.')
      return
    }
    setComprobante(file)
  }

  function resetForm() {
    setForm(EMPTY_FORM)
    setComprobante(null)
    setDraftRestored(false)
    clearDraft()
  }

  function handleSaveDraft() {
    saveDraft(form)
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
        resetForm()
      },
      onError: mutationError => setError(extractErrorMessage(mutationError)),
    })
  }

  const busy = createAppointment.isPending

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-wa-app dark:bg-wa-app-dark">
      <header className="shrink-0 border-b border-wa-border bg-white px-4 py-4 dark:border-wa-border-dark dark:bg-wa-panel-dark sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-green-100 text-wa-primary-strong dark:bg-green-950 dark:text-wa-primary">
              <CalendarPlus className="h-4.5 w-4.5" />
            </span>
            <div>
              <h1 className="text-lg font-semibold text-wa-text dark:text-wa-text-dark">Nueva cita</h1>
              <p className="mt-0.5 text-xs text-wa-muted dark:text-wa-muted-dark">Registra una cita nueva: se crea en Calendar y se avisa por WhatsApp.</p>
            </div>
          </div>
          {isAdmin && (
            <label className="flex shrink-0 items-center gap-2 rounded-lg border border-wa-border px-3 py-1.5 text-xs font-medium text-wa-muted dark:border-wa-border-dark dark:text-wa-muted-dark">
              <FlaskConical className="h-3.5 w-3.5" />
              Modo prueba
              <input
                type="checkbox"
                checked={testMode}
                onChange={e => setTestMode(e.target.checked)}
                className="h-3.5 w-3.5 accent-wa-primary"
              />
            </label>
          )}
        </div>
        {isAdmin && testMode && (
          <p className="mt-2 rounded-lg bg-amber-50 px-3 py-1.5 text-[11px] text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            Se enviará al webhook de prueba de n8n (formMode: test), no a producción.
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <form onSubmit={submit} className="mx-auto max-w-2xl space-y-4">
          {draftRestored && (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-wa-border bg-wa-field px-3 py-2 text-xs text-wa-muted dark:border-wa-border-dark dark:bg-wa-field-dark dark:text-wa-muted-dark">
              <span className="flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 shrink-0" />
                Se restauró un borrador guardado (el comprobante no se guarda, hay que volver a adjuntarlo).
              </span>
              <button type="button" onClick={discardDraft} disabled={busy} className="shrink-0 font-medium text-wa-primary-strong hover:underline disabled:opacity-40 dark:text-wa-primary">
                Descartar
              </button>
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="nc-nombre" className={labelClass}>Nombre completo *</label>
              <Input id="nc-nombre" value={form.nombreCompleto} onChange={e => update('nombreCompleto', e.target.value)} placeholder="Nombre y apellidos del cliente" disabled={busy} required />
            </div>

            <div>
              <label htmlFor="nc-dni" className={labelClass}>DNI</label>
              <Input id="nc-dni" value={form.dni} onChange={e => update('dni', e.target.value)} placeholder="8 dígitos (opcional)" disabled={busy} />
            </div>

            <div>
              <label htmlFor="nc-telefono" className={labelClass}>Teléfono *</label>
              <Input id="nc-telefono" value={form.telefono} onChange={e => update('telefono', e.target.value)} placeholder="999 999 999" disabled={busy} required />
            </div>

            <div>
              <label htmlFor="nc-tratamiento" className={labelClass}>Tratamiento *</label>
              <Select id="nc-tratamiento" value={form.tratamiento} onValueChange={value => update('tratamiento', value)} disabled={busy} required>
                <option value="" disabled>Selecciona un tratamiento</option>
                {TRATAMIENTOS.map(item => <option key={item} value={item}>{item}</option>)}
              </Select>
            </div>

            <div>
              <label htmlFor="nc-vendedor" className={labelClass}>Vendedor *</label>
              <Select id="nc-vendedor" value={form.vendedor} onValueChange={value => update('vendedor', value)} disabled={busy} required>
                <option value="" disabled>Selecciona un vendedor</option>
                {VENDEDORES.map(item => <option key={item} value={item}>{item}</option>)}
              </Select>
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="nc-detalle" className={labelClass}>Detalle</label>
              <Textarea id="nc-detalle" value={form.detalle} onChange={e => update('detalle', e.target.value)} rows={2} placeholder="Zona, precio, sesión. Ej: 1ERA SESION, paquete 3x950, ZONA FRENTE 400 SOLES" disabled={busy} className="h-auto resize-none" />
            </div>

            <div>
              <label htmlFor="nc-fecha" className={labelClass}>Fecha *</label>
              <Input id="nc-fecha" type="date" value={form.fecha} onChange={e => update('fecha', e.target.value)} disabled={busy} required />
            </div>

            <div>
              <label htmlFor="nc-hora" className={labelClass}>Hora *</label>
              <Select id="nc-hora" value={form.hora} onValueChange={value => update('hora', value)} disabled={busy} required>
                <option value="" disabled>Selecciona una hora</option>
                {HORAS.map(item => <option key={item} value={item}>{item}</option>)}
              </Select>
            </div>

            <div>
              <label htmlFor="nc-adelanto" className={labelClass}>Adelanto</label>
              <Input id="nc-adelanto" type="number" min={0} step="0.01" value={form.adelanto} onChange={e => update('adelanto', e.target.value)} placeholder="50 (poner 0 si no separó)" disabled={busy} />
            </div>

            <div className="sm:col-span-2">
              <label className={labelClass}>Comprobante</label>
              {comprobante ? (
                <div className="flex items-center justify-between gap-2 rounded-lg border border-wa-border bg-wa-field px-3 py-2 text-sm text-wa-text dark:border-wa-border-dark dark:bg-wa-field-dark dark:text-wa-text-dark">
                  <span className="min-w-0 truncate">{comprobante.name}</span>
                  <button type="button" onClick={() => setComprobante(null)} disabled={busy} aria-label="Quitar comprobante" className="shrink-0 rounded p-1 text-wa-muted hover:bg-wa-hover disabled:opacity-40">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => fileRef.current?.click()} disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-wa-border px-3 py-2.5 text-sm font-medium text-wa-muted hover:bg-wa-hover disabled:opacity-40 dark:border-wa-border-dark dark:text-wa-muted-dark dark:hover:bg-wa-hover-dark">
                  <FileUp className="h-4 w-4" /> Subir comprobante (JPG, PNG o PDF)
                </button>
              )}
              <input ref={fileRef} type="file" accept="image/jpeg,image/png,application/pdf" onChange={handleFile} className="hidden" />
            </div>
          </div>

          {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={handleSaveDraft} disabled={busy}>
              <Save className="h-4 w-4" /> Guardar borrador
            </Button>
            <Button type="submit" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy ? 'Enviando…' : 'Registrar cita'}
            </Button>
          </div>
        </form>
      </div>
    </main>
  )
}
