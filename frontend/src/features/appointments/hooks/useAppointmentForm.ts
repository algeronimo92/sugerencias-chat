import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
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

/** Clave del campo personalizado donde los negocios cargan el adelanto (la
 *  misma que lee el backend, CUSTOM_ADELANTO_KEY). */
export const DEPOSIT_FIELD_KEY = 'adelanto'

/** Id de cada campo en pantalla: la validación lleva el foco al primero que
 *  falta y la ayuda y el error se enlazan por `aria-describedby`. */
export const FIELD_IDS: Record<keyof AppointmentFormValues, string> = {
  servicio: 'appointment-service',
  fecha: 'appointment-date',
  hora: 'appointment-time',
  vendedor: 'appointment-seller',
  durationMinutes: 'appointment-duration',
  nombreCompleto: 'appointment-name',
  telefono: 'appointment-phone',
  detalle: 'appointment-notes',
}

export const customFieldId = (key: string) => `custom-field-appointment-${key}`
export const customErrorKey = (key: string) => `custom:${key}`

/** Errores por campo: las claves del formulario o `custom:<clave>`. */
export type FieldErrors = Record<string, string>

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
  // Tras cada commit y no durante el render: React puede descartar un render,
  // y el guardado al desmontar leería un borrador que nunca llegó a pantalla.
  useLayoutEffect(() => {
    latest.current = { key, draft, dirty }
  })

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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
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
    clearFieldError(key)
  }

  // Corregir un campo borra su error al instante: la persona ve que lo que
  // hizo sirvió sin tener que volver a intentar guardar.
  function clearFieldError(key: string) {
    setFieldErrors(current => {
      if (!(key in current)) return current
      const next = { ...current }
      delete next[key]
      return next
    })
  }

  function setCustomField(key: string, value: unknown) {
    setCustomFields(current => ({ ...current, [key]: value }))
    setDirty(true)
    clearFieldError(customErrorKey(key))
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
    setForm(EMPTY_APPOINTMENT_FORM); setCustomFields({}); setAttachment(null); setFileError(null); setFieldErrors({})
    discardDraft()
  }

  /** Revisa cada campo, marca los que fallan, lleva el foco al primero y
   *  devuelve un resumen que nombra los campos ("Revisa estos datos: Hora y
   *  Responsable."), o null si se puede guardar. Antes el único aviso era
   *  "Completa los campos obligatorios." arriba del formulario, sin decir cuál
   *  y fuera de la vista de quien acababa de tocar "Guardar" abajo. */
  function validate(): string | null {
    if (customFieldsQuery.isLoading || customFieldsQuery.isError) return 'Espera a que se carguen los campos del negocio.'
    // En el orden en que se ven: reserva, separación, clienta.
    const checks: { key: string; id: string; label: string; message: string | null }[] = []
    const duration = Number(form.durationMinutes)
    checks.push(
      { key: 'servicio', id: FIELD_IDS.servicio, label: 'Tratamiento', message: form.servicio.trim() ? null : 'Elige el tratamiento que separó.' },
      { key: 'fecha', id: FIELD_IDS.fecha, label: 'Fecha', message: form.fecha ? null : 'Elige la fecha de la cita.' },
      { key: 'hora', id: FIELD_IDS.hora, label: 'Hora', message: form.hora ? null : 'Elige la hora.' },
      { key: 'vendedor', id: FIELD_IDS.vendedor, label: 'Responsable', message: form.vendedor ? null : 'Elige quién queda a cargo de la cita.' },
      {
        key: 'durationMinutes', id: FIELD_IDS.durationMinutes, label: 'Duración',
        message: Number.isInteger(duration) && duration >= 5 && duration <= 1440 ? null : 'La duración va de 5 minutos a 24 horas.',
      },
    )
    const ordered = [...definitions].sort((a, b) => Number(b.key === DEPOSIT_FIELD_KEY) - Number(a.key === DEPOSIT_FIELD_KEY))
    const customCheck = (field: (typeof definitions)[number]) => {
      const value = customFields[field.key]
      const empty = value === null || value === undefined || value === ''
      let message: string | null = null
      if (field.required && field.field_type !== 'boolean' && empty) message = `Completa ${field.label.toLowerCase()}.`
      else if (field.key === DEPOSIT_FIELD_KEY && !empty && Number(value) < 0) message = 'El adelanto no puede ser negativo.'
      return { key: customErrorKey(field.key), id: customFieldId(field.key), label: field.label, message }
    }
    const deposit = ordered.filter(field => field.key === DEPOSIT_FIELD_KEY).map(customCheck)
    checks.push(...deposit)
    checks.push(
      { key: 'nombreCompleto', id: FIELD_IDS.nombreCompleto, label: 'Nombre', message: form.nombreCompleto.trim() ? null : 'Escribe el nombre de la clienta.' },
      { key: 'telefono', id: FIELD_IDS.telefono, label: 'Teléfono', message: form.telefono.trim() ? null : 'Escribe el teléfono.' },
    )
    checks.push(...ordered.filter(field => field.key !== DEPOSIT_FIELD_KEY).map(customCheck))

    const failed = checks.filter(check => check.message)
    setFieldErrors(Object.fromEntries(failed.map(check => [check.key, check.message as string])))
    if (failed.length === 0) return null
    // Después del render que muestra los errores.
    requestAnimationFrame(() => document.getElementById(failed[0].id)?.focus())
    const labels = failed.map(check => check.label)
    const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(', ')} y ${labels.at(-1)}`
    return `Revisa ${labels.length === 1 ? 'este dato' : 'estos datos'}: ${list}.`
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
    form, customFields, attachment, error, fileError, fieldErrors, result, definitions,
    customFieldsLoading: customFieldsQuery.isLoading,
    customFieldsError: customFieldsQuery.isError,
    refetchCustomFields: customFieldsQuery.refetch,
    busy: createAppointment.isPending,
    update, setCustomField, load, acceptFile, handleFile, removeAttachment: () => setAttachment(null),
    reset, hasDraft, discardDraft, validate, submit, setError,
  }
}

export type AppointmentFormState = ReturnType<typeof useAppointmentForm>
