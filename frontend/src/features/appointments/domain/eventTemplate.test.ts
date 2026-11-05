import { describe, expect, it } from 'vitest'
import {
  movePiece,
  parseTemplate,
  previewEvent,
  serializeDraft,
  serializeLine,
  insertPiece,
  fieldPiece,
} from './eventTemplate'

const KEYS = new Set(['tratamiento', 'nombre_completo', 'telefono', 'vendedor', 'detalle', 'custom.sede', 'campos_personalizados'])
const DEFAULT_DESCRIPTION = '{detalle}\nContacto: {nombre_completo}\nTeléfono: {telefono}\nResponsable: {vendedor}\n{campos_personalizados}'

describe('plantilla del evento', () => {
  it('vuelve al mismo texto después de leerla', () => {
    const title = '{tratamiento} - {nombre_completo} ({custom.sede})'
    const draft = parseTemplate(title, DEFAULT_DESCRIPTION, KEYS)

    expect(draft.lines).toHaveLength(5)
    expect(serializeDraft(draft)).toEqual({ title, description: DEFAULT_DESCRIPTION })
  })

  it('separa con un espacio dos campos que quedan juntos', () => {
    const draft = parseTemplate('{nombre_completo}', '', KEYS)
    const next = insertPiece(draft, fieldPiece('telefono'), { zone: 'title', index: 1 })

    expect(serializeLine(next.title)).toBe('{nombre_completo} {telefono}')
  })

  it('un marcador desconocido queda como texto visible', () => {
    const draft = parseTemplate('{borrado} {tratamiento}', '', KEYS)

    expect(draft.title.map((piece) => piece.kind)).toEqual(['text', 'field'])
  })

  it('mueve una pieza dentro de la línea y entre líneas', () => {
    const draft = parseTemplate('{tratamiento} {nombre_completo}', 'Tel: {telefono}', KEYS)

    const swapped = movePiece(draft, { zone: 'title', index: 0 }, { zone: 'title', index: 2 })
    expect(serializeLine(swapped.title)).toBe('{nombre_completo} {tratamiento}')

    const moved = movePiece(draft, { zone: 0, index: 1 }, { zone: 'title', index: 0 })
    expect(serializeDraft(moved)).toEqual({ title: '{telefono} {tratamiento} {nombre_completo}', description: 'Tel:' })
  })

  it('no deja la lista de campos personalizados en el título', () => {
    const draft = parseTemplate('{tratamiento}', '{campos_personalizados}', KEYS)

    expect(movePiece(draft, { zone: 0, index: 0 }, { zone: 'title', index: 1 })).toBe(draft)
  })

  it('la vista previa abre los campos personalizados en líneas', () => {
    const draft = parseTemplate('{tratamiento} · {nombre_completo}', 'Tel: {telefono}\n\n{campos_personalizados}', KEYS)
    const preview = previewEvent(draft, [
      { key: 'custom.sede', label: 'Sede', custom: true },
      { key: 'campos_personalizados', label: 'Todos', custom: true },
    ])

    expect(preview).toEqual({ title: 'Consulta · Ana Pérez', description: 'Tel: 987654321\n\nSede: (Sede)' })
  })
})
