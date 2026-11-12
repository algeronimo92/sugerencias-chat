/**
 * El armador de la plantilla del evento de Google Calendar trabaja con piezas
 * (un campo de la cita o un texto libre) ordenadas en líneas. El backend la
 * guarda como texto con marcadores `{campo}`; este módulo traduce entre las
 * dos formas y arma la vista previa con datos de ejemplo.
 */

import {
  PIECE_PLACEHOLDER as PLACEHOLDER,
  insertPiece as insertAnywhere,
  movePiece as moveAnywhere,
  parseLine,
  serializeLine,
  type Piece,
  type PieceDraft,
  type PiecePosition,
  type ZoneId,
} from '../../../shared/pieces'

export { fieldPiece, parseLine, removePiece, serializeLine, textPiece, updatePiece } from '../../../shared/pieces'
export type { Piece, PiecePosition, ZoneId } from '../../../shared/pieces'

export const ALL_CUSTOM_FIELDS = 'campos_personalizados'

export type TemplateDraft = PieceDraft

export function parseTemplate(title: string, description: string, knownKeys: Set<string>): TemplateDraft {
  return {
    title: parseLine(title, knownKeys),
    lines: description.split('\n').map((line) => parseLine(line, knownKeys)),
  }
}

export function serializeDraft(draft: TemplateDraft): { title: string; description: string } {
  const lines = draft.lines.map(serializeLine)
  while (lines.length && !lines[lines.length - 1]) lines.pop()
  return { title: serializeLine(draft.title), description: lines.join('\n') }
}

/** La lista de todos los campos personalizados ocupa líneas propias: en el
 *  título no tiene sentido. */
export function canDrop(piece: Piece, zone: ZoneId): boolean {
  return !(zone === 'title' && piece.kind === 'field' && piece.key === ALL_CUSTOM_FIELDS)
}

export function insertPiece(draft: TemplateDraft, piece: Piece, to: PiecePosition): TemplateDraft {
  return canDrop(piece, to.zone) ? insertAnywhere(draft, piece, to) : draft
}

export function movePiece(draft: TemplateDraft, from: PiecePosition, to: PiecePosition): TemplateDraft {
  const zone = from.zone === 'title' ? draft.title : draft.lines[from.zone] ?? []
  const piece = zone[from.index]
  return piece && canDrop(piece, to.zone) ? moveAnywhere(draft, from, to) : draft
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
