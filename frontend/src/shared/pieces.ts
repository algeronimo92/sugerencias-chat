/**
 * Piezas para armar un texto con datos: cada pieza es un campo (`{clave}`) o
 * un texto libre, ordenadas en líneas. Lo usan el evento del calendario, los
 * avisos de cita y las variables de las plantillas oficiales; cada uno decide
 * qué campos existen y cómo se resuelven.
 */

export type Piece =
  | { id: string; kind: 'field'; key: string }
  | { id: string; kind: 'text'; text: string }

/** `title` es una línea aparte (el título del evento); un número es una línea. */
export type ZoneId = 'title' | number

export interface PieceDraft {
  title: Piece[]
  lines: Piece[][]
}

export interface PiecePosition {
  zone: ZoneId
  index: number
}

export const PIECE_PLACEHOLDER = /\{([a-z0-9_.]+)\}/g

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
  for (const match of line.matchAll(PIECE_PLACEHOLDER)) {
    pushText(line.slice(last, match.index))
    if (knownKeys.has(match[1])) pieces.push(fieldPiece(match[1]))
    else pushText(match[0])
    last = match.index + match[0].length
  }
  pushText(line.slice(last))
  return pieces
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

function zonePieces(draft: PieceDraft, zone: ZoneId): Piece[] {
  return zone === 'title' ? draft.title : draft.lines[zone] ?? []
}

function withZone(draft: PieceDraft, zone: ZoneId, pieces: Piece[]): PieceDraft {
  if (zone === 'title') return { ...draft, title: pieces }
  return { ...draft, lines: draft.lines.map((line, index) => (index === zone ? pieces : line)) }
}

export function insertPiece(draft: PieceDraft, piece: Piece, to: PiecePosition): PieceDraft {
  const pieces = [...zonePieces(draft, to.zone)]
  pieces.splice(Math.max(0, Math.min(to.index, pieces.length)), 0, piece)
  return withZone(draft, to.zone, pieces)
}

export function removePiece(draft: PieceDraft, at: PiecePosition): PieceDraft {
  return withZone(draft, at.zone, zonePieces(draft, at.zone).filter((_, index) => index !== at.index))
}

export function updatePiece(draft: PieceDraft, at: PiecePosition, text: string): PieceDraft {
  return withZone(draft, at.zone, zonePieces(draft, at.zone).map((piece, index) => (
    index === at.index && piece.kind === 'text' ? { ...piece, text } : piece
  )))
}

/** Mueve una pieza a otra posición. `to.index` cuenta las piezas de destino
 *  tal como están antes de sacar la que se mueve. */
export function movePiece(draft: PieceDraft, from: PiecePosition, to: PiecePosition): PieceDraft {
  const piece = zonePieces(draft, from.zone)[from.index]
  if (!piece) return draft
  const sameZone = from.zone === to.zone
  const index = sameZone && to.index > from.index ? to.index - 1 : to.index
  if (sameZone && index === from.index) return draft
  return insertPiece(removePiece(draft, from), piece, { zone: to.zone, index })
}
