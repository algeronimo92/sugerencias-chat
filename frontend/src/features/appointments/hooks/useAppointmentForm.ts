import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useCustomFields } from '../../catalogs/public/useCustomFields'
import type { LeadUpdatesInput } from '../domain/leadPrefill'
import { useCreateAppointment, type AppointmentAttachmentInput, type AppointmentResult } from '../queries'

export const EMPTY_APPOINTMENT_FORM = { nombreCompleto: '', telefono: '', servicio: '', detalle: '', fecha: '', hora: '', vendedor: '', durationMinutes: '60' }
export type AppointmentFormValues = typeof EMPTY_APPOINTMENT_FORM

const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'application/pdf'])
const MAX_BYTES = 10 * 1024 * 1024
// Pausa al escribir antes de guardar el borrador: no se escribe en cada tecla.
const DRAFT_DELAY_MS = 600

interface Draft { form: AppointmentFormValues; customFields: Record<string, unknown> }

export function loadAppointmentDraft(key: string): Draft | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return { form: { ...EMPTY_APPOINTMENT_FORM, ...(parsed.form ?? parsed) }, customFields: parsed.customFields ?? {} }
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

export function appointmentResultMessage(result: AppointmentResult): { text: string; tone: 'success' | 'info' } {
  if (result.integrationErrors?.length) return { text: result.message ?? 'La cita se guardó, pero una integración necesita atención.', tone: 'info' }
  return { text: result.message ?? 'Cita guardada correctamente.', tone: 'success' }
}

function writeDraft(key: string, draft: Draft): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(draft))
    return true
  } catch {
    // Sin almacenamiento (modo privado, cuota llena): el formulario sigue
    // funcionando, solo que no sobrevive a cerrar la pestaña.
    return false
  }
}

function removeDraft(key: string) {
  try { localStorage.removeItem(key) } catch { /* sin almacenamiento: nada que borrar */ }
}

/**
 * Guarda el borrador solo, poco después de cada cambio hecho por el usuario.
 * Lo que entra por ``load`` (prellenado del lead o borrador restaurado) no
 * cuenta como cambio: abrir el panel no deja un borrador que nadie escribió.
 * Al desmontar (cerrar el panel o cambiar de vista) guarda lo pendiente.
 */
function useDraftAutosave(key: string, draft: Draft, dirty: boolean, onSaved: () => void) {
  const latest = useRef({ key, draft, dirty })
  latest.current = { key, draft, dirty }

  useEffect(() => {
    if (!dirty) return
    const timer = setTimeout(() => { if (writeDraft(key, draft)) onSaved() }, DRAFT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [key, draft, dirty, onSaved])

  useEffect(() => () => {
    const pending = latest.current
    if (pending.dirty) writeDraft(pending.key, pending.draft)
  }, [])
}

export interface SubmitOptions {
  testMode?: boolean
  leadId?: string | null
  leadUpdates?: LeadUpdatesInput | null
  onSuccess?: (result: AppointmentResult) => void
}

/**
 * Estado, validación y envío del formulario de cita. Lo comparten la página
 * de Citas (formulario suelto) y el panel de la ficha del lead; cada uno
 * guarda su borrador bajo su propia clave.
 */
export function useAppointmentForm(draftKey: string) {
  const customFieldsQuery = useCustomFields('appointment')
  const definitions = customFieldsQuery.data ?? []
  const [form, setForm] = useState(EMPTY_APPOINTMENT_FORM)
  const [customFields, setCustomFields] = useState<Record<string, unknown>>({})
  const [attachment, setAttachment] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [result, setResult] = useState<AppointmentResult | null>(null)
  const createAppointment = useCreateAppointment()
  // ``dirty``: hay cambios del usuario sin pasar al borrador. ``hasDraft``:
  // existe un borrador guardado de este formulario (restaurado o escrito).
  const [dirty, setDirty] = useState(false)
  const [hasDraft, setHasDraft] = useState(false)
  const markSaved = useCallback(() => { setDirty(false); setHasDraft(true) }, [])
  const draft = useMemo(() => ({ form, customFields }), [form, customFields])
  useDraftAutosave(draftKey, draft, dirty, markSaved)

  function update<K extends keyof AppointmentFormValues>(key: K, value: AppointmentFormValues[K]) {
    setForm(current => ({ ...current, [key]: value }))
    setResult(null)
    setDirty(true)
  }

  function setCustomField(key: string, value: unknown) {
    setCustomFields(current => ({ ...current, [key]: value }))
    setDirty(true)
  }

  /** Reemplaza todo el contenido (borrador restaurado o prellenado del lead).
   *  No es un cambio del usuario: no se guarda como borrador. */
  const load = useCallback((values: Partial<AppointmentFormValues>, custom: Record<string, unknown> = {}, fromDraft = false) => {
    setForm({ ...EMPTY_APPOINTMENT_FORM, ...values })
    setCustomFields(custom)
    setDirty(false)
    setHasDraft(fromDraft)
  }, [])

  /** Borra el borrador guardado; el contenido en pantalla lo decide quien llama. */
  const discardDraft = useCallback(() => {
    removeDraft(draftKey)
    setDirty(false)
    setHasDraft(false)
  }, [draftKey])

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

  function reset() {
    setForm(EMPTY_APPOINTMENT_FORM); setCustomFields({}); setAttachment(null); setFileError(null)
    discardDraft()
  }

  /** El motivo por el que todavía no se puede guardar, o null. */
  function validate(): string | null {
    if (customFieldsQuery.isLoading || customFieldsQuery.isError) return 'Espera a que se carguen los campos del negocio.'
    if (!form.nombreCompleto.trim() || !form.telefono.trim() || !form.servicio.trim() || !form.fecha || !form.hora || !form.vendedor) {
      return 'Completa los campos obligatorios.'
    }
    const duration = Number(form.durationMinutes)
    if (!Number.isInteger(duration) || duration < 5 || duration > 1440) return 'La duración debe estar entre 5 minutos y 24 horas.'
    return null
  }

  async function submit({ testMode = false, leadId = null, leadUpdates = null, onSuccess }: SubmitOptions = {}) {
    setError(null); setResult(null)
    const problem = validate()
    if (problem) { setError(problem); return }
    let prepared: AppointmentAttachmentInput | null = null
    if (attachment) {
      try { prepared = { contentType: attachment.type, dataBase64: await fileToBase64(attachment), filename: attachment.name } }
      catch { setError('No se pudo preparar el adjunto.'); return }
    }
    createAppointment.mutate({
      nombreCompleto: form.nombreCompleto.trim(), dni: '', telefono: form.telefono.trim(),
      tratamiento: form.servicio.trim(), detalle: form.detalle.trim(), fecha: form.fecha,
      hora: form.hora, vendedor: form.vendedor, adelanto: 0, durationMinutes: Number(form.durationMinutes),
      customFields: Object.fromEntries(definitions.map(field => [
        field.key,
        customFields[field.key] ?? (field.field_type === 'boolean' ? false : null),
      ])), comprobante: prepared, testMode, leadId, leadUpdates,
    }, {
      onSuccess: value => {
        const feedback = appointmentResultMessage(value)
        toast[feedback.tone](feedback.text)
        reset(); setResult(value); onSuccess?.(value)
      },
      onError: mutationError => setError(extractErrorMessage(mutationError)),
    })
  }

  return {
    form, customFields, attachment, error, fileError, result, definitions,
    customFieldsLoading: customFieldsQuery.isLoading,
    customFieldsError: customFieldsQuery.isError,
    refetchCustomFields: customFieldsQuery.refetch,
    busy: createAppointment.isPending,
    update, setCustomField, load, acceptFile, handleFile, removeAttachment: () => setAttachment(null),
    reset, hasDraft, discardDraft, validate, submit, setError,
  }
}

export type AppointmentFormState = ReturnType<typeof useAppointmentForm>
