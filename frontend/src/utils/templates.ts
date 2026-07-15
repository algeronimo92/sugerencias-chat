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

export function renderOfficialTemplate(template: MessageTemplate, chat: Chat, parameters?: string[]): string {
  const values = parameters ?? renderOfficialParameterValues(template, chat)
  return template.content.replace(/\{\{(\d+)\}\}/g, (match, position) => values[Number(position) - 1] ?? match)
}

export function renderInteractiveConfig(template: MessageTemplate, chat: Chat): TemplateInteractiveConfig {
  function render(value: unknown): unknown {
    if (typeof value === 'string') return renderTemplateText(value, chat)
    if (Array.isArray(value)) return value.map(render)
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, render(item)]))
    }
    return value
  }
  const rendered = render(template.interactive_config) as TemplateInteractiveConfig
  if (template.interactive_type === 'buttons') rendered.footer = rendered.footer?.trim() || 'DermicaPro'
  if (template.interactive_type === 'list') rendered.footerText = rendered.footerText?.trim() || 'DermicaPro'
  return rendered
}
