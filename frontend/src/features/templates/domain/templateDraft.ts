import type { MessageTemplate, TemplateCategory, TemplateInput } from '../types'
import { fromInteractiveConfig, toInteractiveConfig } from './interactiveConfig'
import { TEMPLATE_LIMITS } from './fieldLimits'
import { EMPTY_TEMPLATE_FORM, type TemplateFormState } from './templateForm'

const PREFERRED_CATEGORY = 'Seguimiento'

/** La categoría con la que arranca una plantilla nueva. */
export function defaultCategory(categories: Pick<TemplateCategory, 'name'>[]): string {
  return categories.find(category => category.name === PREFERRED_CATEGORY)?.name ?? categories[0]?.name ?? ''
}

export function emptyTemplateForm(categories: Pick<TemplateCategory, 'name'>[]): TemplateFormState {
  return { ...structuredClone(EMPTY_TEMPLATE_FORM), category: defaultCategory(categories) }
}

export function formFromTemplate(template: MessageTemplate): TemplateFormState {
  const interactive = fromInteractiveConfig(template.interactive_config)
  return {
    name: template.name,
    shortcut: template.shortcut ?? '',
    content: template.content,
    category: template.category,
    stage: template.stage ?? '',
    taskType: template.task_type ?? '',
    templateType: template.template_type,
    officialName: template.official_name ?? '',
    officialLanguage: template.official_language ?? 'es',
    officialCategory: template.official_category ?? 'UTILITY',
    officialParameterValues: template.official_parameter_values,
    officialHeaderType: template.official_header_type,
    officialHeaderText: template.official_header_text ?? '',
    officialHeaderMediaAssetId: template.official_header_media_asset_id,
    officialFooter: template.official_footer ?? '',
    officialButtons: template.official_buttons,
    interactiveType: template.interactive_type,
    interactiveTitle: interactive.title,
    interactiveFooter: interactive.footer,
    interactiveButtonText: interactive.buttonText,
    interactiveButtons: interactive.buttons,
    interactiveSections: interactive.sections,
  }
}

/** Lo que se manda al backend. Los campos que no son del tipo elegido van
 *  vacíos: una oficial no lleva configuración interactiva y viceversa. */
export function payloadFromForm(form: TemplateFormState): TemplateInput {
  const official = form.templateType === 'official'
  return {
    name: form.name,
    shortcut: form.shortcut || null,
    content: form.content,
    category: form.category,
    stage: form.stage || null,
    task_type: form.taskType || null,
    service: null,
    template_type: form.templateType,
    official_name: official ? form.officialName.trim() : null,
    official_language: official ? form.officialLanguage : null,
    official_category: official ? form.officialCategory : null,
    official_parameter_values: official ? form.officialParameterValues : [],
    official_header_type: official ? form.officialHeaderType : 'none',
    official_header_text: official && form.officialHeaderType === 'text' ? form.officialHeaderText.trim() : null,
    official_header_media_asset_id: official && form.officialHeaderType === 'image' ? form.officialHeaderMediaAssetId : null,
    official_footer: official ? (form.officialFooter.trim() || null) : null,
    official_buttons: official ? form.officialButtons : [],
    interactive_type: official ? 'none' : form.interactiveType,
    interactive_config: official ? {} : toInteractiveConfig(form.interactiveType, {
      title: form.interactiveTitle,
      footer: form.interactiveFooter,
      buttonText: form.interactiveButtonText,
      buttons: form.interactiveButtons,
      sections: form.interactiveSections,
    }),
  }
}

/**
 * El nombre con que Meta registra la plantilla, a partir del que le pone el
 * equipo: «Aviso de cita» → `aviso_de_cita`. Meta solo admite minúsculas,
 * números y guion bajo; antes había que escribir los dos nombres a mano.
 */
export function officialNameFrom(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 512)
}

export function sameForm(left: TemplateFormState, right: TemplateFormState): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

/** Un ID para un botón u opción nuevos que no choque con los que ya hay.
 *  Antes se armaba con la cantidad (`reply_2`): al quitar el primero y sumar
 *  otro se repetía, y el formulario lo rechazaba sin que se viera por qué. */
export function nextFreeId(prefix: string, taken: Iterable<string>): string {
  const used = new Set(taken)
  let index = 1
  while (used.has(`${prefix}${index}`)) index += 1
  return `${prefix}${index}`
}

/**
 * El punto de partida de «Duplicar»: todo lo de otra plantilla salvo lo que
 * tiene que ser único, el atajo y el nombre con que Meta la registra. Los
 * archivos no se copian: se eligen de nuevo, desde la biblioteca.
 */
export function copyOfTemplate(source: MessageTemplate): TemplateFormState {
  const name = `${source.name} (copia)`.slice(0, TEMPLATE_LIMITS.name)
  return {
    ...formFromTemplate(source),
    name,
    shortcut: '',
    officialName: source.template_type === 'official' ? officialNameFrom(name) : '',
  }
}
