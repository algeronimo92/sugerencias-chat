import type { OfficialStatus } from './templateList'

interface EditorSituation {
  /** Se edita una plantilla que ya existe. */
  existing: boolean
  official: boolean
  /** Al guardar, Meta la revisa: es nueva o cambió lo que Meta mira. */
  sendsToReview: boolean
}

/** El texto del botón principal: dice lo que va a pasar. Antes «Guardar»
 *  enviaba una oficial a revisión de Meta sin avisarlo. */
export function submitLabel({ existing, official, sendsToReview }: EditorSituation): string {
  if (official && sendsToReview) return 'Enviar a revisión de Meta'
  return existing ? 'Guardar cambios' : 'Guardar plantilla'
}

interface SaveState {
  saving: boolean
  /** Los cambios ya están respaldados en este dispositivo. */
  backedUp: boolean
  dirty: boolean
  existing: boolean
  status: OfficialStatus | null
}

/** En qué está la plantilla, bajo el título del editor. */
export function stateLine({ saving, backedUp, dirty, existing, status }: SaveState): string {
  if (saving) return 'Guardando…'
  if (backedUp) return 'Cambios sin guardar, respaldados en este dispositivo'
  if (dirty) return 'Cambios sin guardar'
  if (status) return status.label
  return existing ? 'Sin cambios' : 'Todavía no guardada'
}
