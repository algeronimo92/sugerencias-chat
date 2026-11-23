import type { MessageTemplate } from '../types'
import { officialStatus } from './templateList'

/**
 * Qué deja cambiar Meta en una plantilla que ya tiene (2026-11-23).
 *
 * Sale de su guía de gestión de plantillas: solo se edita una aprobada,
 * rechazada o pausada; a una aprobada no se le puede cambiar la categoría y
 * admite un cambio cada 24 horas y diez cada 30 días. El editor dejaba
 * intentar todo y el error de Meta aparecía recién al guardar, sin decir qué
 * regla se había roto.
 */
export interface MetaEditRules {
  /** Meta no acepta cambios al mensaje: está en revisión, deshabilitada o
   *  con el cupo de cambios gastado. */
  contentLocked: boolean
  /** El tipo de mensaje (categoría de Meta) no se puede cambiar. */
  categoryLocked: boolean
  /** Aprobada: cada cambio al mensaje gasta el cupo de ediciones de Meta. */
  limited: boolean
  /** Aprobada con el cupo gastado: desde cuándo acepta Meta otro cambio
   *  (milisegundos). `null` si no hay que esperar. */
  editableFrom: number | null
}

const FREE: MetaEditRules = { contentLocked: false, categoryLocked: false, limited: false, editableFrom: null }

/** El backend informa desde cuándo se puede volver a editar; si esa hora ya
 *  pasó (la lista quedó abierta), no hay nada que esperar. */
function pendingUntil(nextEditAt: string | null | undefined, now: number): number | null {
  if (!nextEditAt) return null
  const moment = Date.parse(nextEditAt)
  return Number.isFinite(moment) && moment > now ? moment : null
}

export function metaEditRules(template: MessageTemplate | undefined, now = Date.now()): MetaEditRules {
  if (!template || template.template_type !== 'official' || template.meta_template_id == null) return FREE
  const kind = officialStatus(template.official_status).kind
  const editableFrom = kind === 'approved' ? pendingUntil(template.official_next_edit_at, now) : null
  const contentLocked = kind === 'review' || kind === 'disabled' || editableFrom !== null
  return { contentLocked, categoryLocked: contentLocked || kind === 'approved', limited: kind === 'approved', editableFrom }
}

/** Por qué no se puede guardar, si el formulario trae un cambio que Meta va
 *  a rechazar (un borrador recuperado de antes de que cambiara el estado). */
export function metaEditBlock(rules: MetaEditRules, changes: { content: boolean; category: boolean }): string | null {
  if (rules.editableFrom !== null && changes.content) {
    return 'Meta todavía no acepta otro cambio en el mensaje de esta plantilla: admite uno cada 24 horas. Lo que escribiste queda en este dispositivo para enviarlo después; el nombre, la categoría del equipo y el atajo sí se pueden guardar ahora.'
  }
  if (rules.contentLocked && (changes.content || changes.category)) {
    return 'Meta no acepta cambios en el mensaje de esta plantilla mientras está en revisión o deshabilitada. Descarta esos cambios; el nombre, la categoría del equipo y el atajo sí se pueden guardar.'
  }
  if (rules.categoryLocked && changes.category) {
    return 'Meta no deja cambiar el tipo de mensaje de una plantilla aprobada. Vuelve a dejarlo como estaba o crea una plantilla nueva con el otro tipo.'
  }
  return null
}
