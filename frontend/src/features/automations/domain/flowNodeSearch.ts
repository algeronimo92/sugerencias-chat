/** Un bloque tal como lo encuentra el buscador del lienzo. */
export interface FlowNodeSearchItem {
  id: string
  number: number | undefined
  title: string
  /** Lo que el bloque dice o configura (mensaje, pregunta, botones…). */
  text: string
}

// Claves que son identificadores internos, no algo que el usuario escribió.
const SKIPPED_KEYS = new Set(['id', 'type', 'condition_type', 'kind', 'source_handle', 'trigger_type', 'task_type', 'priority', 'recipient', 'state'])

/** Los textos que alguien escribió en el bloque, para poder buscarlo por ellos. */
export function searchableText(data: unknown, depth = 0): string {
  if (depth > 4 || data == null) return ''
  if (typeof data === 'string') return data
  if (Array.isArray(data)) return data.map(item => searchableText(item, depth + 1)).filter(Boolean).join(' ')
  if (typeof data !== 'object') return ''
  return Object.entries(data as Record<string, unknown>)
    .filter(([key]) => !SKIPPED_KEYS.has(key))
    .map(([, value]) => searchableText(value, depth + 1))
    .filter(Boolean)
    .join(' ')
    .slice(0, 600)
}

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Bloques que coinciden con lo escrito: "12" o "#12" va al bloque por su
 * número; cualquier otra cosa busca en el título y en lo que el bloque dice,
 * sin distinguir mayúsculas ni tildes. En un flujo de 50 bloques, el número
 * solo no alcanzaba: había que recorrer el lienzo a ojo para encontrarlo.
 */
export function searchFlowNodes(items: FlowNodeSearchItem[], query: string, limit = 8): FlowNodeSearchItem[] {
  const raw = query.trim()
  if (!raw) return []
  const byNumber = (a: FlowNodeSearchItem, b: FlowNodeSearchItem) => (a.number ?? Infinity) - (b.number ?? Infinity)
  const numeric = /^#?\s*(\d+)$/.exec(raw)
  if (numeric) {
    const wanted = numeric[1]
    const exact = items.filter(item => String(item.number) === wanted)
    const prefix = items.filter(item => item.number != null && String(item.number) !== wanted && String(item.number).startsWith(wanted)).sort(byNumber)
    return [...exact, ...prefix].slice(0, limit)
  }
  const needle = normalize(raw)
  const inTitle = items.filter(item => normalize(item.title).includes(needle)).sort(byNumber)
  const inText = items.filter(item => !inTitle.includes(item) && normalize(item.text).includes(needle)).sort(byNumber)
  return [...inTitle, ...inText].slice(0, limit)
}
