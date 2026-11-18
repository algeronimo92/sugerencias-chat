import { describe, expect, it } from 'vitest'
import type { MessageTemplate } from '../../templates/types'
import { automaticTemplatePreviewText, isAutomaticTemplate, templateSendHint } from './automaticTemplates'

function template(overrides: Partial<MessageTemplate> = {}): MessageTemplate {
  return {
    is_active: true, template_type: 'internal', interactive_type: 'none',
    content: 'Hola {{nombre}}', official_status: null, official_parameter_values: [],
    ...overrides,
  } as MessageTemplate
}

function metaTemplate(overrides: Partial<MessageTemplate> = {}): MessageTemplate {
  return template({
    template_type: 'official', content: 'Hola {{1}}, ¿seguimos con {{2}}?',
    official_status: 'APPROVED', official_parameter_values: ['{{nombre}}', '{{ servicio }}'],
    ...overrides,
  })
}

describe('isAutomaticTemplate', () => {
  it('acepta internas sin botones y de Meta aprobadas con datos del lead', () => {
    expect(isAutomaticTemplate(template())).toBe(true)
    expect(isAutomaticTemplate(metaTemplate())).toBe(true)
  })

  it.each([
    ['desactivada', template({ is_active: false })],
    ['interna con botones', template({ interactive_type: 'button' })],
    ['de Meta sin aprobar', metaTemplate({ official_status: 'PENDING' })],
    ['de Meta con datos de la cita', metaTemplate({ official_parameter_values: ['{{nombre}}', '{{cita.fecha}}'] })],
    ['de Meta con variables sin configurar', metaTemplate({ official_parameter_values: [] })],
  ])('rechaza una plantilla %s', (_case, candidate) => {
    expect(isAutomaticTemplate(candidate)).toBe(false)
  })
})

describe('automaticTemplatePreviewText', () => {
  it('muestra qué dato del lead va en cada variable de Meta', () => {
    expect(automaticTemplatePreviewText(metaTemplate())).toBe('Hola {{nombre}}, ¿seguimos con {{ servicio }}?')
  })

  it('deja el texto de una interna tal cual', () => {
    expect(automaticTemplatePreviewText(template())).toBe('Hola {{nombre}}')
  })
})

describe('templateSendHint', () => {
  it('avisa que una de Meta sale sin ventana y se cobra', () => {
    expect(templateSendHint(metaTemplate())).toMatch(/aunque el cliente no haya escrito.*Meta cobra/)
    expect(templateSendHint(null)).toMatch(/últimas 24 horas/)
  })
})
