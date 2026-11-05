/**
 * El armador de la plantilla del evento de Google Calendar trabaja con piezas
 * (un campo de la cita o un texto libre) ordenadas en líneas. El backend la
 * guarda como texto con marcadores `{campo}`; este módulo traduce entre las
 * dos formas y arma la vista previa con datos de ejemplo.
 */

export const ALL_CUSTOM_FIELDS = 'campos_personalizados'

export type Piece =
  | { id: string; kind: 'field'; key: string }
  | { id: string; kind: 'text'; text: string }

/** `title` es la única línea del título; un número es una línea de la descripción. */
export type ZoneId = 'title' | number

export interface TemplateDraft {
  title: Piece[]
  lines: Piece[][]
}

export interface PiecePosition {
  zone: ZoneId
  index: number
}

const PLACEHOLDER = /\{([a-z0-9_.]+)\}/g

let nextId = 0
const newId = () => `p${++nextId}`

export function fieldPiece(key: string): Piece {
  return { id: newId(), kind: 'field', key }
}

export function textPiece(text = ''): Piece {
  return { id: newId(), kind: 'text', text }
}

/** Un marcador desconocido queda como texto: así se ve y se puede borrar. */
export function parseLine(line: string, knownKeys: Set<string>): Piece[] {
  const pieces: Piece[] = []
  let last = 0
  const pushText = (raw: string) => {
    const text = raw.trim()
    if (!text) return
    const previous = pieces[pieces.length - 1]
    if (previous?.kind === 'text') previous.text = `${previous.text} ${text}`
    else pieces.push(textPiece(text))
  }
  for (const match of line.matchAll(PLACEHOLDER)) {
    pushText(line.slice(last, match.index))
    if (knownKeys.has(match[1])) pieces.push(fieldPiece(match[1]))
    else pushText(match[0])
    last = match.index + match[0].length
  }
  pushText(line.slice(last))
  return pieces
}

export function parseTemplate(title: string, description: string, knownKeys: Set<string>): TemplateDraft {
  return {
    title: parseLine(title, knownKeys),
    lines: description.split('\n').map((line) => parseLine(line, knownKeys)),
  }
}

// Las piezas se unen con un espacio, salvo junto a la puntuación que va
// pegada: "({custom.sede})" o "{nombre_completo}, {telefono}".
const GLUE_AFTER = /[([¿¡#]$/
const GLUE_BEFORE = /^[)\],.:;!?%]/

function pieceText(piece: Piece): string {
  return piece.kind === 'field' ? `{${piece.key}}` : piece.text.trim()
}

export function serializeLine(pieces: Piece[]): string {
  let line = ''
  for (const piece of pieces) {
    const text = pieceText(piece)
    if (!text) continue
    const glued = !line || GLUE_AFTER.test(line) || GLUE_BEFORE.test(text)
    line += glued ? text : ` ${text}`
  }
  return line
}

export function serializeDraft(draft: TemplateDraft): { title: string; description: string } {
  const lines = draft.lines.map(serializeLine)
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  return { title: serializeLine(draft.title), description: lines.join('\n') }
}

function zonePieces(draft: TemplateDraft, zone: ZoneId): Piece[] {
  return zone === 'title' ? draft.title : draft.lines[zone] ?? []
}

function withZone(draft: TemplateDraft, zone: ZoneId, pieces: Piece[]): TemplateDraft {
  if (zone === 'title') return { ...draft, title: pieces }
  return { ...draft, lines: draft.lines.map((line, index) => (index === zone ? pieces : line)) }
}

/** La lista de todos los campos personalizados ocupa líneas propias: en el
 *  título no tiene sentido. */
export function canDrop(piece: Piece, zone: ZoneId): boolean {
  return !(zone === 'title' && piece.kind === 'field' && piece.key === ALL_CUSTOM_FIELDS)
}

export function insertPiece(draft: TemplateDraft, piece: Piece, to: PiecePosition): TemplateDraft {
  if (!canDrop(piece, to.zone)) return draft
  const pieces = [...zonePieces(draft, to.zone)]
  pieces.splice(Math.max(0, Math.min(to.index, pieces.length)), 0, piece)
  return withZone(draft, to.zone, pieces)
}

export function removePiece(draft: TemplateDraft, at: PiecePosition): TemplateDraft {
  return withZone(draft, at.zone, zonePieces(draft, at.zone).filter((_, index) => index !== at.index))
}

export function updatePiece(draft: TemplateDraft, at: PiecePosition, text: string): TemplateDraft {
  return withZone(draft, at.zone, zonePieces(draft, at.zone).map((piece, index) => (
    index === at.index && piece.kind === 'text' ? { ...piece, text } : piece
  )))
}

/** Mueve una pieza a otra posición. `to.index` cuenta las piezas de destino
 *  tal como están antes de sacar la que se mueve. */
export function movePiece(draft: TemplateDraft, from: PiecePosition, to: PiecePosition): TemplateDraft {
  const piece = zonePieces(draft, from.zone)[from.index]
  if (!piece || !canDrop(piece, to.zone)) return draft
  const sameZone = from.zone === to.zone
  const index = sameZone && to.index > from.index ? to.index - 1 : to.index
  if (sameZone && index === from.index) return draft
  return insertPiece(removePiece(draft, from), piece, { zone: to.zone, index })
}

export function addLine(draft: TemplateDraft, after?: number): TemplateDraft {
  const lines = [...draft.lines]
  lines.splice(after === undefined ? lines.length : after + 1, 0, [])
  return { ...draft, lines }
}

export function removeLine(draft: TemplateDraft, index: number): TemplateDraft {
  const lines = draft.lines.filter((_, current) => current !== index)
  return { ...draft, lines: lines.length ? lines : [[]] }
}

export interface PreviewField {
  key: string
  label: string
  custom: boolean
}

const SAMPLE_VALUES: Record<string, string> = {
  tratamiento: 'Consulta',
  nombre_completo: 'Ana Pérez',
  telefono: '987654321',
  dni: '45678912',
  vendedor: 'Antonella',
  detalle: 'Primera evaluación',
  fecha: '2026-10-21',
  hora: '10:00',
  duration_minutes: '60',
  adelanto: '50',
}

function sampleValue(key: string, labels: Map<string, string>): string {
  return SAMPLE_VALUES[key] ?? `(${labels.get(key) ?? key})`
}

/** El evento como se vería con una cita de ejemplo. Repite la regla del
 *  backend que importa al leerlo: la lista de campos personalizados se abre en
 *  una línea por campo y un título vacío cae al servicio. */
export function previewEvent(draft: TemplateDraft, fields: PreviewField[]): { title: string; description: string } {
  const labels = new Map(fields.map((field) => [field.key, field.label]))
  const customLines = fields
    .filter((field) => field.custom && field.key !== ALL_CUSTOM_FIELDS)
    .map((field) => `${field.label}: ${sampleValue(field.key, labels)}`)
  const render = (pieces: Piece[]) => serializeLine(pieces).replace(PLACEHOLDER, (_, key: string) => (
    key === ALL_CUSTOM_FIELDS ? customLines.join(', ') : sampleValue(key, labels)
  ))
  const lines = draft.lines.flatMap((pieces) => (
    pieces.length === 1 && pieces[0].kind === 'field' && pieces[0].key === ALL_CUSTOM_FIELDS
      ? customLines
      : [render(pieces)]
  ))
  const compact = lines.filter((line, index) => line || (index > 0 && lines[index - 1]))
  while (compact.length && !compact[compact.length - 1]) compact.pop()
  while (compact.length && !compact[0]) compact.shift()
  return { title: render(draft.title) || SAMPLE_VALUES.tratamiento, description: compact.join('\n') }
}
