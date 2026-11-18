import { templateParameterIdentifiers } from '../../templates/public/templates'
import type { MessageTemplate } from '../../templates/types'

/**
 * Qué plantillas puede mandar una automatización. Espejo de
 * `automatic_template_problem` (backend, `automations/domain/templates.py`):
 * internas sin botones ni lista, y de Meta aprobadas cuyas variables salen
 * todas del lead. Las que usan datos de la cita quedan afuera porque una regla
 * no sabe de qué cita se trata.
 */
const LEAD_VARIABLES = new Set(['nombre', 'telefono', 'servicio', 'vendedor', 'fecha_actual'])
const VARIABLE = /\{\{\s*([^{}]+?)\s*\}\}/g

export function isMetaTemplate(template: Pick<MessageTemplate, 'template_type'>): boolean {
  return template.template_type === 'official'
}

export function isAutomaticTemplate(template: MessageTemplate): boolean {
  if (!template.is_active) return false
  if (!isMetaTemplate(template)) return template.interactive_type === 'none'
  if (template.official_status !== 'APPROVED') return false
  const values = template.official_parameter_values
  if (values.length !== templateParameterIdentifiers(template.content).length) return false
  return values.every(value => Array.from(value.matchAll(VARIABLE), match => match[1]).every(name => LEAD_VARIABLES.has(name)))
}

/** El texto de la plantilla con cada variable de Meta ({{1}}) cambiada por
 * lo que se configuró para ella en Plantillas ({{nombre}}): así el editor
 * muestra qué dato del lead va en cada lugar. */
export function automaticTemplatePreviewText(template: MessageTemplate): string {
  if (!isMetaTemplate(template)) return template.content
  const identifiers = templateParameterIdentifiers(template.content)
  const values = template.official_parameter_values
  if (identifiers.length > 0 && identifiers.every(identifier => /^\d+$/.test(identifier))) {
    return template.content.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, position: string) => values[Number(position) - 1] ?? match)
  }
  let index = 0
  return template.content.replace(/\{\{\s*[^{}]+?\s*\}\}/g, match => values[index++] ?? match)
}

export function templateSendHint(template: MessageTemplate | null): string {
  // Una línea: el detalle está en el «?» del bloque (domain/blockHelp.ts).
  if (template && isMetaTemplate(template)) return 'De Meta: sale sin ventana de 24 h · Meta cobra el envío'
  return 'Interna: necesita la ventana de 24 h abierta'
}
