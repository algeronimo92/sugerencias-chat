import { describe, expect, it } from 'vitest'
import type { InteractiveLimits } from '../types'
import { EMPTY_TEMPLATE_FORM, validateTemplateForm, type TemplateFormState } from './templateForm'

const LIMITS: InteractiveLimits = {
  text: 4096, body: 1024, title: 60, footer: 60, button_text: 20, button_id: 256, max_buttons: 3,
  list_button_text: 20, section_title: 24, row_title: 24, row_description: 72, row_id: 200,
  max_sections: 10, max_rows: 10,
}

function form(overrides: Partial<TemplateFormState> = {}): TemplateFormState {
  return { ...EMPTY_TEMPLATE_FORM, name: 'Saludo', content: 'Hola {{nombre}}', category: 'Seguimiento', ...overrides }
}

function errorsOf(overrides: Partial<TemplateFormState> = {}, limits: InteractiveLimits | undefined = LIMITS) {
  return validateTemplateForm(form(overrides), limits)
}

describe('validateTemplateForm · campos comunes', () => {
  it('acepta una plantilla interna mínima', () => {
    expect(errorsOf()).toEqual([])
  })

  it('exige nombre, contenido y categoría', () => {
    expect(errorsOf({ name: '  ' })).toContain('El nombre es obligatorio.')
    expect(errorsOf({ content: '' })).toContain('El contenido es obligatorio.')
    expect(errorsOf({ category: '' })).toContain('La categoría es obligatoria.')
  })

  it('aplica el límite de contenido que manda el backend', () => {
    expect(errorsOf({ content: 'x'.repeat(4097) })).toContain('El contenido admite máximo 4096 caracteres para este tipo de plantilla.')
    expect(errorsOf({ content: 'x'.repeat(2000), templateType: 'official', officialName: 'hola', officialLanguage: 'es' }))
      .toContain('El contenido admite máximo 1024 caracteres para este tipo de plantilla.')
  })

  it('no aplica límites de longitud mientras el backend no los informó', () => {
    expect(validateTemplateForm(form({ content: 'x'.repeat(9000) }))).toEqual([])
  })

  it('valida el formato del atajo', () => {
    expect(errorsOf({ shortcut: '/Saludo Rápido' })).toContain('El atajo admite máximo 50 caracteres: letras minúsculas, números, - y _.')
    expect(errorsOf({ shortcut: '/saludo_1' })).toEqual([])
  })

  it('rechaza variables desconocidas', () => {
    expect(errorsOf({ content: 'Hola {{apellido}}' })).toContain('Variables no reconocidas: {{apellido}}.')
  })
})

describe('validateTemplateForm · plantilla oficial', () => {
  function official(overrides: Partial<TemplateFormState> = {}) {
    return errorsOf({
      templateType: 'official', officialName: 'seguimiento_cliente', officialLanguage: 'es_PE',
      content: 'Hola {{1}}', officialParameterValues: ['{{nombre}}'], ...overrides,
    })
  }

  it('acepta una oficial bien formada', () => {
    expect(official()).toEqual([])
  })

  it('valida nombre e idioma', () => {
    expect(official({ officialName: 'Seguimiento Cliente' })).toContain('El nombre oficial admite minúsculas, números y guiones bajos (máximo 512).')
    expect(official({ officialLanguage: 'espanol' })).toContain('El idioma oficial debe tener un formato como es, es_PE o en_US.')
  })

  it('exige variables numéricas consecutivas y un valor para cada una', () => {
    expect(official({ content: 'Hola {{nombre}}', officialParameterValues: [] }))
      .toContain('El contenido oficial solo admite variables numéricas como {{1}}, {{2}}, ...')
    expect(official({ content: 'Hola {{1}} y {{3}}', officialParameterValues: ['a', 'b', 'c'] }))
      .toContain('Las variables oficiales deben ser consecutivas: {{1}}, {{2}}, ...')
    expect(official({ officialParameterValues: ['  '] })).toContain('Configura un valor para cada variable oficial.')
  })

  it('valida encabezado, pie y sus variables', () => {
    expect(official({ officialHeaderType: 'text', officialHeaderText: '' })).toContain('El encabezado de texto no puede estar vacío.')
    expect(official({ officialHeaderType: 'text', officialHeaderText: 'Hola {{nombre}}' })).toContain('El encabezado no admite variables.')
    expect(official({ officialHeaderType: 'image', officialHeaderMediaAssetId: null })).toContain('Selecciona una imagen para el encabezado.')
    expect(official({ officialFooter: 'x'.repeat(61) })).toContain('El pie admite máximo 60 caracteres.')
    expect(official({ officialFooter: '{{nombre}}' })).toContain('El pie no admite variables.')
  })

  it('valida los botones oficiales', () => {
    expect(official({ officialButtons: [
      { type: 'quick_reply', text: 'Sí' }, { type: 'url', text: 'Web', url: 'https://x.com' },
    ] })).toContain('Los botones de respuesta rápida no pueden mezclarse con botones de URL o teléfono.')
    expect(official({ officialButtons: [
      { type: 'url', text: 'A', url: 'https://x.com' }, { type: 'url', text: 'B', url: 'https://y.com' },
      { type: 'url', text: 'C', url: 'https://z.com' },
    ] })).toContain('Una plantilla oficial admite como máximo 2 botones de URL o teléfono.')
    expect(official({ officialButtons: [{ type: 'url', text: 'Web', url: 'http://x.com' }] }))
      .toContain('Las URL de botones deben ser completas y comenzar con https://.')
    expect(official({ officialButtons: [{ type: 'phone_number', text: 'Llamar', phone_number: '123' }] }))
      .toContain('El teléfono del botón debe incluir código de país y tener entre 8 y 15 dígitos.')
    expect(official({ officialButtons: [{ type: 'quick_reply', text: 'Sí' }, { type: 'quick_reply', text: 'sí' }] }))
      .toContain('Cada botón necesita un texto único.')
  })
})

describe('validateTemplateForm · interactivas', () => {
  function buttons(overrides: Partial<TemplateFormState> = {}) {
    return errorsOf({
      interactiveType: 'buttons', interactiveTitle: 'Turnos',
      interactiveButtons: [{ type: 'reply', displayText: 'Sí', id: 'reply_1' }], ...overrides,
    })
  }

  function list(overrides: Partial<TemplateFormState> = {}) {
    return errorsOf({
      interactiveType: 'list', interactiveTitle: 'Tratamientos', interactiveButtonText: 'Ver opciones',
      interactiveSections: [{ title: 'Faciales', rows: [{ title: 'Limpieza', description: '60 min', rowId: 'l1' }] }],
      ...overrides,
    })
  }

  it('acepta botones y lista bien formados', () => {
    expect(buttons()).toEqual([])
    expect(list()).toEqual([])
  })

  it('exige título y respeta los límites del backend', () => {
    expect(buttons({ interactiveTitle: '' })).toContain('El título interactivo es obligatorio.')
    expect(buttons({ interactiveTitle: 'x'.repeat(61) })).toContain('El título interactivo admite máximo 60 caracteres.')
    expect(buttons({ interactiveFooter: 'x'.repeat(61) })).toContain('El pie de mensaje admite máximo 60 caracteres.')
  })

  it('valida la cantidad, el texto y el id de los botones', () => {
    expect(buttons({ interactiveButtons: [] })).toContain('Configura entre 1 y 3 botones.')
    expect(buttons({ interactiveButtons: [{ type: 'reply', displayText: '', id: 'r1' }] })).toContain('El botón 1 necesita texto visible.')
    expect(buttons({ interactiveButtons: [{ type: 'reply', displayText: 'x'.repeat(21), id: 'r1' }] }))
      .toContain('El texto del botón 1 admite máximo 20 caracteres.')
    expect(buttons({ interactiveButtons: [
      { type: 'reply', displayText: 'Sí', id: 'r1' }, { type: 'reply', displayText: 'sí', id: 'r2' },
    ] })).toContain('El texto del botón 2 está repetido.')
    expect(buttons({ interactiveButtons: [
      { type: 'reply', displayText: 'Sí', id: 'r1' }, { type: 'reply', displayText: 'No', id: 'r1' },
    ] })).toContain('El ID del botón 2 está repetido.')
  })

  it('valida secciones y opciones de una lista', () => {
    expect(list({ interactiveButtonText: '' })).toContain('El texto que abre la lista es obligatorio.')
    expect(list({ interactiveSections: [] })).toContain('Configura entre 1 y 10 secciones.')
    expect(list({ interactiveSections: [{ title: '', rows: [{ title: 'a', description: 'b', rowId: 'c' }] }] }))
      .toContain('La sección 1 necesita título.')
    expect(list({ interactiveSections: [{ title: 'Faciales', rows: [] }] })).toContain('La sección 1 necesita al menos una opción.')
    expect(list({ interactiveSections: [{ title: 'Faciales', rows: [{ title: '', description: '', rowId: '' }] }] }))
      .toEqual(expect.arrayContaining([
        'Opción 1 de la sección 1: el título es obligatorio.',
        'Opción 1 de la sección 1: la descripción es obligatoria.',
        'Opción 1 de la sección 1: el ID es obligatorio.',
      ]))
  })

  it('limita el total de opciones de una lista', () => {
    const rows = Array.from({ length: 11 }, (_, index) => ({ title: `t${index}`, description: 'd', rowId: `id${index}` }))

    expect(list({ interactiveSections: [{ title: 'Faciales', rows }] }))
      .toContain('Una lista admite máximo 10 opciones en total.')
  })
})
