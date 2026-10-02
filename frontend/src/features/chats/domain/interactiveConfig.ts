import type { InteractiveListSection,TemplateInteractiveConfig,TemplateInteractiveType } from '../types'

/** Botón de respuesta tal como lo edita el formulario de plantillas. */
export interface EditableReplyButton {
  id: string
  title: string
}

/** Sección de lista tal como la edita el formulario de plantillas. */
export interface EditableListSection {
  title: string
  rows: { id: string; title: string; description: string }[]
}

export interface EditableInteractive {
  title: string
  footer: string
  buttonText: string
  buttons: EditableReplyButton[]
  sections: EditableListSection[]
}

/** Configuración de Meta (`header`, `footer`, `action`) a partir del
 * formulario. Un encabezado o pie vacío no se manda. */
export function toInteractiveConfig(
  type: TemplateInteractiveType,
  form: EditableInteractive,
): TemplateInteractiveConfig {
  if (type === 'none') return {}
  const config: TemplateInteractiveConfig = {}
  const title = form.title.trim()
  const footer = form.footer.trim()
  if (title) config.header = { type: 'text', text: title }
  if (footer) config.footer = { text: footer }
  if (type === 'button') {
    config.action = {
      buttons: form.buttons.map(button => ({
        type: 'reply',
        reply: { id: button.id.trim(), title: button.title.trim() },
      })),
    }
  } else {
    config.action = {
      button: form.buttonText.trim(),
      sections: form.sections.map((section): InteractiveListSection => ({
        title: section.title.trim(),
        rows: section.rows.map(row => ({
          id: row.id.trim(),
          title: row.title.trim(),
          ...(row.description.trim() ? { description: row.description.trim() } : {}),
        })),
      })),
    }
  }
  return config
}

export const DEFAULT_REPLY_BUTTON: EditableReplyButton = { id: 'reply_1', title: '' }
export const DEFAULT_LIST_SECTION: EditableListSection = {
  title: 'Opciones',
  rows: [{ id: 'option_1', title: '', description: '' }],
}

/** Formulario a partir de la configuración guardada en la plantilla. */
export function fromInteractiveConfig(config: TemplateInteractiveConfig): EditableInteractive {
  const buttons = (config.action?.buttons ?? []).map(button => ({ id: button.reply.id, title: button.reply.title }))
  const sections = (config.action?.sections ?? []).map(section => ({
    title: section.title ?? '',
    rows: section.rows.map(row => ({ id: row.id, title: row.title, description: row.description ?? '' })),
  }))
  return {
    title: config.header?.text ?? '',
    footer: config.footer?.text ?? '',
    buttonText: config.action?.button ?? 'Ver opciones',
    buttons: buttons.length ? buttons : [{ ...DEFAULT_REPLY_BUTTON }],
    sections: sections.length ? sections : [structuredClone(DEFAULT_LIST_SECTION)],
  }
}
