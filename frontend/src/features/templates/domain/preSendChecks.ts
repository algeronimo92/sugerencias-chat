import type { TemplateFormState } from './templateForm'

/**
 * Lo que Meta suele rechazar en una plantilla, comprobado antes de enviarla
 * (2026-11-23). Son avisos, no bloquean: Meta revisa además el contenido, que
 * acá no se puede adivinar. Las reglas salen de su guía de revisión de
 * plantillas: un dato al principio o al final del texto, dos datos pegados,
 * y demasiados datos para lo que mide el texto.
 */
export interface PreSendCheck {
  id: 'examples' | 'edges' | 'adjacent' | 'ratio' | 'duplicate'
  ok: boolean
  label: string
  /** Qué hacer cuando no se cumple. */
  fix: string
}

const VARIABLE = /\{\{\s*\d+\s*\}\}/g
const FORMAT_MARKS = /[*_~`]/g

function plain(content: string): string {
  return content.replace(FORMAT_MARKS, '').trim()
}

function comparable(content: string): string {
  return plain(content).replace(VARIABLE, '{}').replace(/\s+/g, ' ').toLowerCase()
}

/** Meta no publica la proporción exacta entre palabras y datos; este mínimo
 *  (dos palabras por dato, más una) es orientativo y avisa antes que ella. */
function hasEnoughText(text: string, variables: number): boolean {
  const words = text.replace(VARIABLE, ' ').split(/\s+/).filter(Boolean).length
  return words >= variables * 2 + 1
}

export function preSendChecks(
  form: Pick<TemplateFormState, 'content' | 'officialParameterValues'>,
  otherOfficialBodies: string[],
): PreSendCheck[] {
  const text = plain(form.content)
  const variables = text.match(VARIABLE)?.length ?? 0
  const startsOrEnds = /^\{\{\s*\d+\s*\}\}/.test(text) || /\{\{\s*\d+\s*\}\}$/.test(text)
  const body = comparable(form.content)

  return [
    {
      id: 'examples',
      ok: form.officialParameterValues.every(value => value.trim() !== ''),
      label: 'Cada dato tiene su ejemplo',
      fix: 'Elige qué dato lleva cada variable: de ahí sale el ejemplo que revisa Meta.',
    },
    {
      id: 'edges',
      ok: !startsOrEnds,
      label: 'El texto no empieza ni termina con un dato',
      fix: 'Agrega texto antes del primer dato y después del último.',
    },
    {
      id: 'adjacent',
      ok: !/\}\}\s*\{\{/.test(text),
      label: 'Hay texto entre un dato y el siguiente',
      fix: 'Separa los datos con alguna palabra: Meta no acepta dos seguidos.',
    },
    {
      id: 'ratio',
      ok: variables === 0 || hasEnoughText(text, variables),
      label: 'Hay texto suficiente alrededor de los datos',
      fix: 'Alarga el mensaje o quita datos: Meta rechaza textos que son casi solo variables.',
    },
    {
      id: 'duplicate',
      ok: body === '' || !otherOfficialBodies.some(other => comparable(other) === body),
      label: 'No repite el texto de otra plantilla',
      fix: 'Ya tienes una plantilla oficial con este mismo texto: cámbialo o usa la que existe.',
    },
  ]
}
