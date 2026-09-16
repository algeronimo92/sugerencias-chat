import { describe, expect, it } from 'vitest'

import type { Chat, MessageTemplate } from '../types'
import { renderOfficialTemplate, templateParameterIdentifiers } from './templates'

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
