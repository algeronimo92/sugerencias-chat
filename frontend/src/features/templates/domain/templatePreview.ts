import { LEAD_SOURCES, sampleOf } from './officialParameters'
import type { TemplateFormState } from './templateForm'

export interface PreviewButton {
  text: string
  kind: 'reply' | 'url' | 'phone' | 'list'
}

/** El mensaje como lo recibe el cliente, armado con datos de ejemplo. */
export interface TemplatePreviewModel {
  header: string | null
  headerImageAssetId: number | null
  body: string
  footer: string | null
  buttons: PreviewButton[]
}

const LEAD_SAMPLES = new Map(LEAD_SOURCES.map(source => [source.key, source.sample]))

/** El texto de una interna con el cliente de ejemplo. Sin datos, cada hueco
 *  queda vacío: es lo que pasa al enviarla a un lead al que le falta ese
 *  dato («Hola .»), y conviene verlo antes de guardar. */
function renderInternal(text: string, withData: boolean): string {
  return text.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => {
    if (!LEAD_SAMPLES.has(key)) return whole
    return withData ? LEAD_SAMPLES.get(key) ?? '' : ''
  })
}

function renderOfficial(content: string, values: string[]): string {
  return content.replace(/\{\{\s*(\d+)\s*\}\}/g, (whole, position: string) => {
    const value = values[Number(position) - 1]
    return value?.trim() ? sampleOf(value) : whole
  })
}

const OFFICIAL_BUTTON_KIND = { quick_reply: 'reply', url: 'url', phone_number: 'phone' } as const

export function previewOf(
  form: TemplateFormState,
  options: { withData: boolean; defaultFooter?: string },
): TemplatePreviewModel {
  if (form.templateType === 'official') {
    return {
      header: form.officialHeaderType === 'text' ? form.officialHeaderText.trim() || null : null,
      headerImageAssetId: form.officialHeaderType === 'image' ? form.officialHeaderMediaAssetId : null,
      body: renderOfficial(form.content, form.officialParameterValues),
      footer: form.officialFooter.trim() || null,
      buttons: form.officialButtons
        .filter(button => button.text.trim())
        .map(button => ({ text: button.text.trim(), kind: OFFICIAL_BUTTON_KIND[button.type] })),
    }
  }

  const body = renderInternal(form.content, options.withData)
  if (form.interactiveType === 'none') {
    return { header: null, headerImageAssetId: null, body, footer: null, buttons: [] }
  }
  // Mismo pie por defecto que aplica el backend al enviar: el nombre del negocio.
  const footer = renderInternal(form.interactiveFooter, options.withData).trim() || options.defaultFooter || null
  return {
    header: renderInternal(form.interactiveTitle, options.withData).trim() || null,
    headerImageAssetId: null,
    body,
    footer,
    buttons: form.interactiveType === 'button'
      ? form.interactiveButtons.filter(button => button.title.trim()).map(button => ({ text: button.title.trim(), kind: 'reply' as const }))
      : [{ text: form.interactiveButtonText.trim() || 'Ver opciones', kind: 'list' as const }],
  }
}

/** Las variables de lead que usa el texto de una interna. */
export function internalVariablesIn(content: string): string[] {
  const found = new Set(Array.from(content.matchAll(/\{\{(\w+)\}\}/g), match => match[1]))
  return LEAD_SOURCES.filter(source => found.has(source.key)).map(source => source.label)
}
