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
