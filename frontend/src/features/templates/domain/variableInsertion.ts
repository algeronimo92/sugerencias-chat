import { templateParameterIdentifiers } from '../utils/templates'

/** Pone `token` donde está el cursor del texto (o al final) y deja el cursor
 *  justo después, para seguir escribiendo. Si había texto seleccionado, lo
 *  reemplaza, como al escribir. */
export function insertAtCursor(
  field: Pick<HTMLTextAreaElement, 'selectionStart' | 'selectionEnd'> | null,
  value: string,
  token: string,
): { value: string; caret: number } {
  const start = field?.selectionStart ?? value.length
  const end = field?.selectionEnd ?? value.length
  return { value: value.slice(0, start) + token + value.slice(end), caret: start + token.length }
}

/** La siguiente variable de una plantilla de Meta: `{{1}}`, `{{2}}`… */
export function nextMetaVariable(content: string): string {
  const numeric = templateParameterIdentifiers(content).filter(identifier => /^\d+$/.test(identifier)).map(Number)
  return `{{${(numeric.length ? Math.max(...numeric) : 0) + 1}}}`
}
