import { currentBrandName } from '../../../shared/branding'
import type { Chat } from '../../leads/types'
import type { MessageTemplate, TemplateInteractiveConfig } from '../types'

export function renderTemplate(template: MessageTemplate, chat: Chat): string {
  return renderTemplateText(template.content, chat)
}

export function renderTemplateText(content: string, chat: Chat): string {
  const values: Record<string, string> = {
    nombre: chat.name ?? '',
    telefono: chat.phone ?? '',
    servicio: chat.servicio_interes ?? '',
    vendedor: chat.vendedor ?? '',
    fecha_actual: new Date().toLocaleDateString(),
  }
  return content.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? `{{${key}}}`)
}

export function renderOfficialParameterValues(template: MessageTemplate, chat: Chat): string[] {
  return template.official_parameter_values.map(value => renderTemplateText(value, chat))
}

/** Espejo de `template_parameter_identifiers` en el backend (`meta_service.py`):
 * si todas las variables del body son numéricas ({{1}}, {{2}}...) es el
 * formato posicional clásico, con una entrada por posición distinta; si
 * alguna tiene nombre ({{cliente}}) se listan tal cual aparecen, en orden,
 * porque cada aparición consume su propio valor. */
export function templateParameterIdentifiers(content: string): string[] {
  const matches = Array.from(content.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), match => match[1].trim())
  if (matches.length > 0 && matches.every(match => /^\d+$/.test(match))) {
    const highest = Math.max(...matches.map(Number))
    return Array.from({ length: highest }, (_, index) => String(index + 1))
  }
  return matches
}

/** Sin distinguir el formato de variable, una plantilla importada con
 * nombre ({{cliente}}) mostraba el placeholder crudo en vez del valor real,
 * porque el reemplazo solo buscaba posiciones numéricas ({{1}}, {{2}}...). */
export function renderOfficialTemplate(template: MessageTemplate, chat: Chat, parameters?: string[]): string {
  const values = parameters ?? renderOfficialParameterValues(template, chat)
  const identifiers = templateParameterIdentifiers(template.content)
  if (identifiers.length > 0 && identifiers.every(identifier => /^\d+$/.test(identifier))) {
    return template.content.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, position) => values[Number(position) - 1] ?? match)
  }
  let index = 0
  return template.content.replace(/\{\{\s*[^{}]+?\s*\}\}/g, match => values[index++] ?? match)
}

/** Resuelve las variables del CRM en cada texto de la configuración
 * interactiva (encabezado, pie, botones, secciones y opciones), sin tocar
 * la estructura de Meta. */
function renderConfigValue<T>(value: T, chat: Chat): T {
  if (typeof value === 'string') return renderTemplateText(value, chat) as T
  if (Array.isArray(value)) return value.map(item => renderConfigValue(item, chat)) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, renderConfigValue(item, chat)]),
    ) as T
  }
  return value
}

export function renderInteractiveConfig(template: MessageTemplate, chat: Chat): TemplateInteractiveConfig {
  const rendered = renderConfigValue(template.interactive_config, chat)
  // Mismo pie por defecto que aplica el backend: el nombre del negocio.
  if (template.interactive_type !== 'none' && !rendered.footer?.text?.trim()) {
    return { ...rendered, footer: { text: currentBrandName() } }
  }
  return rendered
}
