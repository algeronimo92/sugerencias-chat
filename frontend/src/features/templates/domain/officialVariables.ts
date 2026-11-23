import { templateParameterIdentifiers } from '../utils/templates'
import { PARAMETER_KEYS } from './officialParameters'
import { insertAtCursor, nextMetaVariable } from './variableInsertion'

/** Una entrada por variable del texto, conservando las ya armadas. */
export function resizeParameters(content: string, current: string[]): string[] {
  return templateParameterIdentifiers(content).map((_, index) => current[index] ?? '')
}

/**
 * Inserta en el texto la siguiente variable de Meta ya unida a un dato del
 * lead o de la cita (2026-11-23).
 *
 * Antes eran dos pasos separados por medio formulario: escribir `{{1}}` a
 * mano y, más abajo, elegir qué dato llevaba. Kommo y ManyChat insertan el
 * dato por su nombre; acá el texto conserva el `{{1}}` que exige Meta y el
 * dato queda elegido en el mismo gesto.
 */
export function insertDataVariable(
  field: Pick<HTMLTextAreaElement, 'selectionStart' | 'selectionEnd'> | null,
  content: string,
  values: string[],
  sourceKey: string,
): { content: string; caret: number; values: string[] } {
  const token = nextMetaVariable(content)
  const position = Number(token.replace(/\D/g, ''))
  const inserted = insertAtCursor(field, content, token)
  const next = resizeParameters(inserted.value, values)
  if (position >= 1 && position <= next.length) next[position - 1] = `{{${sourceKey}}}`
  return { content: inserted.value, caret: inserted.caret, values: next }
}

/** El dato de una variable cuando es uno solo y sin texto alrededor
 *  (`{{nombre}}`); `null` si está vacía o mezcla datos y texto. */
export function singleSource(value: string): string | null {
  const match = /^\{\{\s*([a-z0-9_.]+)\s*\}\}$/.exec(value.trim())
  return match && PARAMETER_KEYS.has(match[1]) ? match[1] : null
}

/** Envuelve la selección del texto con una marca de formato de WhatsApp
 *  (`*negrita*`, `_cursiva_`). Sin selección deja el cursor entre las marcas. */
export function wrapSelection(
  field: Pick<HTMLTextAreaElement, 'selectionStart' | 'selectionEnd'> | null,
  value: string,
  mark: string,
): { value: string; selectionStart: number; selectionEnd: number } {
  const start = field?.selectionStart ?? value.length
  const end = field?.selectionEnd ?? value.length
  const selected = value.slice(start, end)
  return {
    value: value.slice(0, start) + mark + selected + mark + value.slice(end),
    selectionStart: start + mark.length,
    selectionEnd: end + mark.length,
  }
}
