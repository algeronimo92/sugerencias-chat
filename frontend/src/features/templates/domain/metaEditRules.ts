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
  /** Meta no acepta cambios al mensaje: está en revisión o deshabilitada. */
  contentLocked: boolean
  /** El tipo de mensaje (categoría de Meta) no se puede cambiar. */
  categoryLocked: boolean
  /** Aprobada: cada cambio al mensaje gasta el cupo de ediciones de Meta. */
  limited: boolean
}

const FREE: MetaEditRules = { contentLocked: false, categoryLocked: false, limited: false }

export function metaEditRules(template: MessageTemplate | undefined): MetaEditRules {
  if (!template || template.template_type !== 'official' || template.meta_template_id == null) return FREE
  const kind = officialStatus(template.official_status).kind
  const contentLocked = kind === 'review' || kind === 'disabled'
  return { contentLocked, categoryLocked: contentLocked || kind === 'approved', limited: kind === 'approved' }
}

/** Por qué no se puede guardar, si el formulario trae un cambio que Meta va
 *  a rechazar (un borrador recuperado de antes de que cambiara el estado). */
export function metaEditBlock(rules: MetaEditRules, changes: { content: boolean; category: boolean }): string | null {
  if (rules.contentLocked && (changes.content || changes.category)) {
    return 'Meta no acepta cambios en el mensaje de esta plantilla mientras está en revisión o deshabilitada. Descarta esos cambios; el nombre, la categoría del equipo y el atajo sí se pueden guardar.'
  }
  if (rules.categoryLocked && changes.category) {
    return 'Meta no deja cambiar el tipo de mensaje de una plantilla aprobada. Vuelve a dejarlo como estaba o crea una plantilla nueva con el otro tipo.'
  }
  return null
}
