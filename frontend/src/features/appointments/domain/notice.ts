/** Cómo se leen las variables de la plantilla oficial de un aviso de cita y
 *  cómo sale cada una con los datos de una cita. */

/** Las variables de la plantilla en el orden en que aparecen: `{{1}}` o con
 *  nombre (`{{cliente}}`), cada una una sola vez. */
export function templateVariables(content: string): string[] {
  const names: string[] = []
  for (const match of content.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)) {
    if (!names.includes(match[1])) names.push(match[1])
  }
  return names
}

const FIELD = /\{([a-z0-9_.]+)\}/g

/** Meta rechaza una variable vacía: la que se arma solo con campos que
 *  quedaron vacíos sale "-". Lo mismo hace el backend al enviar. */
export const EMPTY_VALUE = '-'

/** Una variable armada (texto con `{campo}`) con los datos de una cita. Sin
 *  `values` (no hay citas todavía) cada campo se muestra por su nombre. */
export function renderParameter(template: string, labels: Map<string, string>, values?: Record<string, string>): string {
  const keys = [...template.matchAll(FIELD)].map(match => match[1])
  if (values && keys.length > 0 && keys.every(key => !values[key])) return EMPTY_VALUE
  const rendered = template.replace(FIELD, (_whole, key: string) => (
    values ? values[key] ?? '' : `[${labels.get(key) ?? key}]`
  ))
  return rendered.split(/\s+/).filter(Boolean).join(' ') || (template.trim() ? EMPTY_VALUE : '')
}

/** El mensaje completo con cada variable ya resuelta. Una variable sin armar
 *  queda como `{{n}}` para que se note lo que falta. */
export function previewNotice(content: string, rendered: string[]): string {
  const variables = templateVariables(content)
  return content.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (whole, name: string) => rendered[variables.indexOf(name)] || whole)
}

/** Cómo se nombra un campo dentro de una variable: los del lead llevan
 *  "Lead ·" para no confundir su teléfono o servicio con los de la cita. */
export function pieceLabels(fields: Array<{ key: string; label: string; group: string }>): Map<string, string> {
  return new Map(fields.map(field => [
    field.key,
    field.group.startsWith('lead') ? `Lead · ${field.label}` : field.label,
  ]))
}
