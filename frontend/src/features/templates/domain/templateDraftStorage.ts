import { EMPTY_TEMPLATE_FORM, type TemplateFormState } from './templateForm'

/**
 * Respaldo local de lo que se está escribiendo en el editor (2026-11-23).
 *
 * El formulario viejo perdía todo al tocar «Cancelar», el lápiz de otra
 * plantilla o al cerrar la pestaña. Ahora el borrador se guarda solo en este
 * dispositivo y se recupera al volver. Los archivos elegidos no entran: un
 * `File` no se puede guardar acá, y se avisa al recuperar.
 */
const PREFIX = 'template-editor-draft:'
const VERSION = 1

export interface StoredTemplateDraft {
  form: TemplateFormState
  /** Si el nombre para Meta se escribió a mano (ya no sigue al nombre). */
  officialNameEdited: boolean
  savedAt: number
}

function keyOf(templateId: number | null): string {
  return `${PREFIX}${templateId ?? 'new'}`
}

export function loadTemplateDraft(templateId: number | null): StoredTemplateDraft | null {
  try {
    const raw = localStorage.getItem(keyOf(templateId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<StoredTemplateDraft> & { version?: number }
    if (parsed.version !== VERSION || !parsed.form || typeof parsed.savedAt !== 'number') return null
    return {
      form: { ...EMPTY_TEMPLATE_FORM, ...parsed.form },
      officialNameEdited: Boolean(parsed.officialNameEdited),
      savedAt: parsed.savedAt,
    }
  } catch {
    return null
  }
}

export function saveTemplateDraft(templateId: number | null, draft: StoredTemplateDraft): boolean {
  try {
    localStorage.setItem(keyOf(templateId), JSON.stringify({ version: VERSION, ...draft }))
    return true
  } catch {
    // Sin almacenamiento (modo privado, cuota llena): el editor sigue
    // funcionando, solo que el borrador no sobrevive a cerrar la pestaña.
    return false
  }
}

export function clearTemplateDraft(templateId: number | null) {
  try { localStorage.removeItem(keyOf(templateId)) } catch { /* sin almacenamiento: nada que borrar */ }
}

/** «hace 3 min», para decir de cuándo es un borrador. */
export function elapsedLabel(since: number, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - since) / 60_000))
  if (minutes < 1) return 'hace un momento'
  if (minutes < 60) return `hace ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `hace ${hours} h`
  const days = Math.round(hours / 24)
  return `hace ${days} día${days === 1 ? '' : 's'}`
}
