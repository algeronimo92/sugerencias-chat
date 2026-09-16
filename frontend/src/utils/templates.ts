import type { Chat, MessageTemplate, TemplateInteractiveConfig } from '../types'

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

export function renderInteractiveConfig(template: MessageTemplate, chat: Chat): TemplateInteractiveConfig {
  const render = (value: string | undefined) => value === undefined
    ? undefined
    : renderTemplateText(value, chat)
  const config = template.interactive_config
  const rendered: TemplateInteractiveConfig = {
    title: render(config.title),
    footer: render(config.footer),
    footerText: render(config.footerText),
    buttonText: render(config.buttonText),
    buttons: config.buttons?.map(button => ({
      ...button,
      displayText: renderTemplateText(button.displayText, chat),
      id: render(button.id),
      url: render(button.url),
      phoneNumber: render(button.phoneNumber),
      copyCode: render(button.copyCode),
    })),
    sections: config.sections?.map(section => ({
      title: renderTemplateText(section.title, chat),
      rows: section.rows.map(row => ({
        title: renderTemplateText(row.title, chat),
        description: renderTemplateText(row.description, chat),
        rowId: renderTemplateText(row.rowId, chat),
      })),
    })),
  }
  if (template.interactive_type === 'buttons') rendered.footer = rendered.footer?.trim() || 'DermicaPro'
  if (template.interactive_type === 'list') rendered.footerText = rendered.footerText?.trim() || 'DermicaPro'
  return rendered
}
