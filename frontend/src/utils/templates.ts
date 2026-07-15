import type { Chat, MessageTemplate } from '../types'

export function renderTemplate(template: MessageTemplate, chat: Chat): string {
  const values: Record<string, string> = {
    nombre: chat.name ?? '',
    telefono: chat.phone ?? '',
    servicio: chat.servicio_interes ?? '',
    vendedor: chat.vendedor ?? '',
    fecha_actual: new Date().toLocaleDateString(),
  }
  return template.content.replace(/\{\{(\w+)\}\}/g, (_, key) => values[key] ?? `{{${key}}}`)
}
