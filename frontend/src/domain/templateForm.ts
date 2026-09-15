import type {
  InteractiveLimits, LeadStage, MessageTemplate, OfficialTemplateButton, TaskType,
  TemplateInteractiveButton, TemplateInteractiveSection,
} from '../types'
import { z } from 'zod'
import { exceedsLimit } from './interactiveRules'

export const ALLOWED_INTERNAL_VARIABLES = new Set(['nombre', 'telefono', 'servicio', 'vendedor', 'fecha_actual'])

export interface TemplateFormState {
  name: string
  shortcut: string
  content: string
  category: string
  stage: LeadStage | ''
  taskType: TaskType | ''
  templateType: MessageTemplate['template_type']
  officialName: string
  officialLanguage: string
  officialCategory: NonNullable<MessageTemplate['official_category']>
  officialParameterValues: string[]
  officialHeaderType: MessageTemplate['official_header_type']
  officialHeaderText: string
  officialHeaderMediaAssetId: number | null
  officialFooter: string
  officialButtons: OfficialTemplateButton[]
  interactiveType: MessageTemplate['interactive_type']
  interactiveTitle: string
  interactiveFooter: string
  interactiveButtonText: string
  interactiveButtons: TemplateInteractiveButton[]
  interactiveSections: TemplateInteractiveSection[]
}

export const EMPTY_TEMPLATE_FORM: TemplateFormState = {
  name: '',
  shortcut: '',
  content: '',
  category: 'Seguimiento',
  stage: '',
  taskType: '',
  templateType: 'internal',
  officialName: '',
  officialLanguage: 'es',
  officialCategory: 'UTILITY',
  officialParameterValues: [],
  officialHeaderType: 'none',
  officialHeaderText: '',
  officialHeaderMediaAssetId: null,
  officialFooter: '',
  officialButtons: [],
  interactiveType: 'none',
  interactiveTitle: '',
  interactiveFooter: '',
  interactiveButtonText: 'Ver opciones',
  interactiveButtons: [{ type: 'reply', displayText: '', id: 'reply_1' }],
  interactiveSections: [{ title: 'Opciones', rows: [{ title: '', description: '', rowId: 'option_1' }] }],
}

export function templateVariables(...values: string[]) {
  return new Set(values.flatMap(value => Array.from(value.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g), match => match[1].trim())))
}

type Issues = z.RefinementCtx

/** Un problema del formulario, con el mismo texto que ve el usuario. */
function report(ctx: Issues, message: string) {
  ctx.addIssue({ code: 'custom', message })
}

function withinLimit(ctx: Issues, value: string, limit: number | undefined, message: (limit: number) => string) {
  if (exceedsLimit(value, limit)) report(ctx, message(limit as number))
}

function templateKind(form: TemplateFormState): 'official' | 'buttons' | 'list' | 'text' {
  if (form.templateType === 'official') return 'official'
  if (form.interactiveType === 'none') return 'text'
  return form.interactiveType === 'buttons' ? 'buttons' : 'list'
}

function contentLimit(form: TemplateFormState, limits?: InteractiveLimits): number | undefined {
  return templateKind(form) === 'text' ? limits?.text : limits?.body
}

/** Campos que comparten todas las plantillas. El límite del contenido lo
 * manda el backend (ver /api/templates/capabilities), así que el esquema se
 * arma con los límites vigentes en vez de repetirlos acá. */
function commonSchema(form: TemplateFormState, limits?: InteractiveLimits) {
  const limit = contentLimit(form, limits)
  return z.object({
    name: z.string().trim()
      .min(1, 'El nombre es obligatorio.')
      .max(120, 'El nombre admite máximo 120 caracteres.'),
    content: z.string().trim()
      .min(1, 'El contenido es obligatorio.')
      .refine(
        value => !exceedsLimit(value, limit),
        `El contenido admite máximo ${limit} caracteres para este tipo de plantilla.`,
      ),
    category: z.string().trim()
      .min(1, 'La categoría es obligatoria.')
      .max(60, 'La categoría admite máximo 60 caracteres.'),
    shortcut: z.string()
      .transform(value => value.trim().replace(/^\/+/, '').toLowerCase())
      .refine(
        value => !value || (value.length <= 50 && /^[a-z0-9_-]+$/.test(value)),
        'El atajo admite máximo 50 caracteres: letras minúsculas, números, - y _.',
      ),
  })
}

function officialRules(form: TemplateFormState, _limits: InteractiveLimits | undefined, ctx: Issues) {
  const content = form.content.trim()
  const officialName = form.officialName.trim()
  if (!/^[a-z0-9_]+$/.test(officialName) || officialName.length > 512) {
    report(ctx, 'El nombre oficial admite minúsculas, números y guiones bajos (máximo 512).')
  }
  if (!/^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(form.officialLanguage.trim())) {
    report(ctx, 'El idioma oficial debe tener un formato como es, es_PE o en_US.')
  }

  const variables = templateVariables(content)
  if ([...variables].some(value => !/^\d+$/.test(value))) {
    report(ctx, 'El contenido oficial solo admite variables numéricas como {{1}}, {{2}}, ...')
  }
  const positions = [...variables].filter(value => /^\d+$/.test(value)).map(Number).sort((a, b) => a - b)
  const expected = Array.from({ length: positions.at(-1) ?? 0 }, (_, index) => index + 1)
  if (positions.length !== expected.length || positions.some((value, index) => value !== expected[index])) {
    report(ctx, 'Las variables oficiales deben ser consecutivas: {{1}}, {{2}}, ...')
  }
  if (form.officialParameterValues.length !== expected.length || form.officialParameterValues.some(value => !value.trim())) {
    report(ctx, 'Configura un valor para cada variable oficial.')
  }
  const unknownParameters = [...templateVariables(...form.officialParameterValues)]
    .filter(value => !ALLOWED_INTERNAL_VARIABLES.has(value))
  if (unknownParameters.length) {
    report(ctx, `Variables no reconocidas en los parámetros: ${unknownParameters.map(value => `{{${value}}}`).join(', ')}.`)
  }

  if (form.officialHeaderType === 'text') {
    const headerText = form.officialHeaderText.trim()
    if (!headerText) report(ctx, 'El encabezado de texto no puede estar vacío.')
    else if (headerText.length > 60) report(ctx, 'El encabezado admite máximo 60 caracteres.')
    if (templateVariables(headerText).size > 0) report(ctx, 'El encabezado no admite variables.')
  }
  if (form.officialHeaderType === 'image' && form.officialHeaderMediaAssetId == null) {
    report(ctx, 'Selecciona una imagen para el encabezado.')
  }

  const footer = form.officialFooter.trim()
  if (footer.length > 60) report(ctx, 'El pie admite máximo 60 caracteres.')
  if (templateVariables(footer).size > 0) report(ctx, 'El pie no admite variables.')

  officialButtonRules(form.officialButtons, ctx)
}

function officialButtonRules(buttons: TemplateFormState['officialButtons'], ctx: Issues) {
  if (buttons.length > 3) report(ctx, 'Una plantilla oficial admite como máximo 3 botones.')
  const hasQuickReply = buttons.some(button => button.type === 'quick_reply')
  if (hasQuickReply && buttons.some(button => button.type !== 'quick_reply')) {
    report(ctx, 'Los botones de respuesta rápida no pueden mezclarse con botones de URL o teléfono.')
  }
  if (!hasQuickReply && buttons.length > 2) {
    report(ctx, 'Una plantilla oficial admite como máximo 2 botones de URL o teléfono.')
  }
  const seen = new Set<string>()
  for (const button of buttons) {
    const text = button.text.trim()
    if (!text || seen.has(text.toLowerCase())) report(ctx, 'Cada botón necesita un texto único.')
    else if (text.length > 25) report(ctx, 'El texto de cada botón admite máximo 25 caracteres.')
    seen.add(text.toLowerCase())
    if (button.type === 'url' && !/^https:\/\/\S+$/i.test(button.url?.trim() ?? '')) {
      report(ctx, 'Las URL de botones deben ser completas y comenzar con https://.')
    }
    if (button.type === 'phone_number' && !/^\+?[1-9]\d{7,14}$/.test((button.phone_number ?? '').replace(/[\s()-]/g, ''))) {
      report(ctx, 'El teléfono del botón debe incluir código de país y tener entre 8 y 15 dígitos.')
    }
  }
}

function internalVariableRules(form: TemplateFormState, ctx: Issues) {
  const interactiveValues = form.interactiveType === 'none' ? '' : JSON.stringify({
    title: form.interactiveTitle,
    footer: form.interactiveFooter,
    buttonText: form.interactiveButtonText,
    buttons: form.interactiveButtons,
    sections: form.interactiveSections,
  })
  const unknown = [...templateVariables(form.content.trim(), interactiveValues)]
    .filter(value => !ALLOWED_INTERNAL_VARIABLES.has(value))
  if (unknown.length) report(ctx, `Variables no reconocidas: ${unknown.map(value => `{{${value}}}`).join(', ')}.`)
}

function interactiveHeaderRules(form: TemplateFormState, limits: InteractiveLimits | undefined, ctx: Issues) {
  const title = form.interactiveTitle.trim()
  if (!title) report(ctx, 'El título interactivo es obligatorio.')
  else withinLimit(ctx, title, limits?.title, limit => `El título interactivo admite máximo ${limit} caracteres.`)
  withinLimit(ctx, form.interactiveFooter.trim(), limits?.footer, limit => `El pie de mensaje admite máximo ${limit} caracteres.`)
}

function buttonsRules(form: TemplateFormState, limits: InteractiveLimits | undefined, ctx: Issues) {
  internalVariableRules(form, ctx)
  interactiveHeaderRules(form, limits, ctx)
  // Meta solo acepta botones "reply" en un mensaje interactivo suelto: un
  // botón de URL, llamada o copiar código necesita una plantilla oficial.
  const buttons = form.interactiveButtons
  if (buttons.length < 1 || (limits && buttons.length > limits.max_buttons)) {
    report(ctx, `Configura entre 1 y ${limits?.max_buttons ?? 'el máximo de'} botones.`)
  }
  const texts = new Set<string>()
  const ids = new Set<string>()
  buttons.forEach((button, index) => {
    const label = button.displayText.trim()
    if (!label) report(ctx, `El botón ${index + 1} necesita texto visible.`)
    else if (exceedsLimit(label, limits?.button_text)) report(ctx, `El texto del botón ${index + 1} admite máximo ${limits?.button_text} caracteres.`)
    else if (texts.has(label.toLowerCase())) report(ctx, `El texto del botón ${index + 1} está repetido.`)
    texts.add(label.toLowerCase())
    const value = (button.id ?? '').trim()
    withinLimit(ctx, value, limits?.button_id, limit => `El ID del botón ${index + 1} admite máximo ${limit} caracteres.`)
    if (value && ids.has(value)) report(ctx, `El ID del botón ${index + 1} está repetido.`)
    ids.add(value)
  })
}

function listRules(form: TemplateFormState, limits: InteractiveLimits | undefined, ctx: Issues) {
  internalVariableRules(form, ctx)
  interactiveHeaderRules(form, limits, ctx)
  const buttonText = form.interactiveButtonText.trim()
  if (!buttonText) report(ctx, 'El texto que abre la lista es obligatorio.')
  else withinLimit(ctx, buttonText, limits?.list_button_text, limit => `El texto que abre la lista admite máximo ${limit} caracteres.`)
  if (!form.interactiveSections.length || (limits && form.interactiveSections.length > limits.max_sections)) {
    report(ctx, `Configura entre 1 y ${limits?.max_sections ?? 'el máximo de'} secciones.`)
  }

  const sectionTitles = new Set<string>()
  const rowIds = new Set<string>()
  let totalRows = 0
  form.interactiveSections.forEach((section, sectionIndex) => {
    const sectionTitle = section.title.trim()
    if (!sectionTitle) report(ctx, `La sección ${sectionIndex + 1} necesita título.`)
    else if (exceedsLimit(sectionTitle, limits?.section_title)) report(ctx, `El título de la sección ${sectionIndex + 1} admite máximo ${limits?.section_title} caracteres.`)
    else if (sectionTitles.has(sectionTitle.toLowerCase())) report(ctx, `El título de la sección ${sectionIndex + 1} está repetido.`)
    sectionTitles.add(sectionTitle.toLowerCase())
    if (!section.rows.length) report(ctx, `La sección ${sectionIndex + 1} necesita al menos una opción.`)
    section.rows.forEach((row, rowIndex) => {
      totalRows += 1
      const prefix = `Opción ${rowIndex + 1} de la sección ${sectionIndex + 1}`
      if (!row.title.trim()) report(ctx, `${prefix}: el título es obligatorio.`)
      else withinLimit(ctx, row.title.trim(), limits?.row_title, limit => `${prefix}: el título admite máximo ${limit} caracteres.`)
      if (!row.description.trim()) report(ctx, `${prefix}: la descripción es obligatoria.`)
      else withinLimit(ctx, row.description.trim(), limits?.row_description, limit => `${prefix}: la descripción admite máximo ${limit} caracteres.`)
      const rowId = row.rowId.trim()
      if (!rowId) report(ctx, `${prefix}: el ID es obligatorio.`)
      else if (exceedsLimit(rowId, limits?.row_id)) report(ctx, `${prefix}: el ID admite máximo ${limits?.row_id} caracteres.`)
      else if (rowIds.has(rowId)) report(ctx, `${prefix}: el ID está repetido.`)
      rowIds.add(rowId)
    })
  })
  if (limits && totalRows > limits.max_rows) report(ctx, `Una lista admite máximo ${limits.max_rows} opciones en total.`)
}

type TemplateKindRules = (form: TemplateFormState, limits: InteractiveLimits | undefined, ctx: Issues) => void

/** Una entrada por tipo de plantilla: agregar un tipo nuevo es sumar su
 * regla acá, sin tocar el resto de la validación. */
export const TEMPLATE_KIND_RULES: Record<ReturnType<typeof templateKind>, TemplateKindRules> = {
  official: officialRules,
  buttons: buttonsRules,
  list: listRules,
  text: (form, _limits, ctx) => internalVariableRules(form, ctx),
}

export function templateFormSchema(form: TemplateFormState, limits?: InteractiveLimits) {
  return commonSchema(form, limits).superRefine((_value, ctx) => {
    TEMPLATE_KIND_RULES[templateKind(form)](form, limits, ctx)
  })
}

export function validateTemplateForm(form: TemplateFormState, limits?: InteractiveLimits): string[] {
  const result = templateFormSchema(form, limits).safeParse(form)
  return result.success ? [] : result.error.issues.map(issue => issue.message)
}
