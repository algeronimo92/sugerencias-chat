import { describe, expect, it } from 'vitest'

import type { Chat } from '../../leads/types'
import type { MessageTemplate } from '../types'
import { renderOfficialParameterValues, renderOfficialTemplate, templateParameterIdentifiers } from './templates'

function chat(overrides: Partial<Chat> = {}): Chat {
  return {
    chat_id: 'lead-1',
    name: 'Ana',
    phone: '51999999999',
    servicio_interes: null,
    vendedor: null,
    ...overrides,
  } as Chat
}

function officialTemplate(content: string, official_parameter_values: string[] = []): MessageTemplate {
  return { content, official_parameter_values } as MessageTemplate
}

describe('templateParameterIdentifiers', () => {
  it('deduplica posiciones numéricas repetidas', () => {
    expect(templateParameterIdentifiers('Hola {{1}}, tu turno es {{2}}. Gracias {{1}}.')).toEqual(['1', '2'])
  })

  it('lista cada aparición con nombre en orden', () => {
    expect(templateParameterIdentifiers('Hola {{cliente}}, tu turno es {{fecha}}.')).toEqual(['cliente', 'fecha'])
  })
})

describe('renderOfficialTemplate', () => {
  it('sustituye variables posicionales por posición', () => {
    const template = officialTemplate('Hola {{1}}, tu turno es {{2}}.')
    expect(renderOfficialTemplate(template, chat(), ['Ana', 'martes'])).toBe('Hola Ana, tu turno es martes.')
  })

  it('sustituye variables con nombre en el orden en que aparecen, en vez de dejarlas crudas', () => {
    const template = officialTemplate('Hola {{cliente}}, tu turno es {{fecha}}.')
    expect(renderOfficialTemplate(template, chat(), ['Ana', 'martes'])).toBe('Hola Ana, tu turno es martes.')
  })
})

describe('variables con datos de la cita desde un chat', () => {
  it('usa la próxima cita del lead y deja vacío lo que no se sabe', () => {
    const template = { ...officialTemplate('Tu cita es el {{1}} a las {{2}}, {{3}}'), official_parameter_values: ['{{cita.fecha_larga}}', '{{cita.hora_12h}}', '{{cita.tratamiento}}'] }
    const at = new Date(2026, 10, 12, 13, 0)
    expect(renderOfficialParameterValues(template, { ...chat(), proxima_cita: at.toISOString() })).toEqual(['JUEVES 12 de Noviembre', '01:00 Pm', ''])
    expect(renderOfficialParameterValues(template, { ...chat(), proxima_cita: null })).toEqual(['', '', ''])
  })
})
