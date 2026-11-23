import { beforeEach, describe, expect, it } from 'vitest'
import type { MessageTemplate } from '../types'
import { TEMPLATE_LIMITS, contentLimit, counterTone } from './fieldLimits'
import { metaEditBlock, metaEditRules } from './metaEditRules'
import { insertDataVariable, resizeParameters, singleSource, wrapSelection } from './officialVariables'
import { preSendChecks } from './preSendChecks'
import { emptyTemplateForm, nextFreeId, officialNameFrom, payloadFromForm } from './templateDraft'
import { clearTemplateDraft, elapsedLabel, loadTemplateDraft, saveTemplateDraft, templateIdsWithDraft } from './templateDraftStorage'
import { EMPTY_TEMPLATE_FORM, templateFormIssues, type TemplateFormState } from './templateForm'
import { NO_FILTERS, filterTemplates, officialStatus, rejectedReason, sortByUse } from './templateList'
import { internalVariablesIn, previewOf } from './templatePreview'
import { whenLabel } from './whenLabel'

const LIMITS = {
  text: 4096, body: 1024, title: 60, footer: 60, button_text: 20, button_id: 256, max_buttons: 3,
  list_button_text: 20, section_title: 24, row_title: 24, row_description: 72, row_id: 200,
  max_sections: 10, max_rows: 10,
}

function form(overrides: Partial<TemplateFormState> = {}): TemplateFormState {
  return { ...EMPTY_TEMPLATE_FORM, name: 'Saludo', content: 'Hola {{nombre}}', ...overrides }
}

function official(overrides: Partial<TemplateFormState> = {}): TemplateFormState {
  return form({
    templateType: 'official', officialName: 'aviso_de_cita', content: 'Hola {{1}}, tu cita quedó registrada.',
    officialParameterValues: ['{{nombre}}'], ...overrides,
  })
}

describe('topes y contador', () => {
  it('el texto de una interna de solo texto usa el tope de WhatsApp; con botones u oficial, el del cuerpo', () => {
    expect(contentLimit(form(), LIMITS)).toBe(4096)
    expect(contentLimit(form({ interactiveType: 'button' }), LIMITS)).toBe(1024)
    expect(contentLimit(official(), LIMITS)).toBe(1024)
    expect(contentLimit(form(), undefined)).toBeUndefined()
  })

  it('el contador cambia de tono al acercarse, al llegar y al pasarse', () => {
    expect(counterTone(10, 60)).toBe('calm')
    expect(counterTone(54, 60)).toBe('near')
    expect(counterTone(60, 60)).toBe('full')
    expect(counterTone(61, 60)).toBe('over')
  })

  it('los topes coinciden con los que valida el backend', () => {
    expect(TEMPLATE_LIMITS).toMatchObject({ name: 120, shortcut: 50, category: 60, officialName: 512, officialHeaderText: 60, officialFooter: 60, officialButtonText: 25, officialButtonUrl: 2000 })
  })
})

describe('errores por campo', () => {
  it('cada problema dice a qué campo pertenece', () => {
    const issues = templateFormIssues(form({ name: ' ', shortcut: 'hifu 12d', content: '' }), LIMITS)
    expect(issues.map(issue => issue.field).sort()).toEqual(['content', 'name', 'shortcut'])
  })

  it('en una oficial separa encabezado, pie, botones y variables', () => {
    const issues = templateFormIssues(official({
      officialHeaderType: 'text', officialHeaderText: '', officialFooter: 'Pie con {{1}}',
      officialButtons: [{ type: 'url', text: 'Ver', url: 'http://inseguro' }], officialParameterValues: [''],
    }), LIMITS)
    expect(new Set(issues.map(issue => issue.field))).toEqual(new Set(['officialHeader', 'officialFooter', 'officialButtons', 'officialParameterValues']))
  })
})

describe('nombre para Meta e IDs', () => {
  it('arma el nombre de Meta a partir del nombre visible', () => {
    expect(officialNameFrom('Aviso de cita')).toBe('aviso_de_cita')
    expect(officialNameFrom('  ¡Promoción  Día de la Madre! ')).toBe('promocion_dia_de_la_madre')
  })

  it('un ID nuevo no repite uno que quedó tras quitar otro', () => {
    // Antes se armaba con la cantidad: con [reply_2] daba «reply_2» otra vez.
    expect(nextFreeId('reply_', ['reply_2'])).toBe('reply_1')
    expect(nextFreeId('reply_', ['reply_1', 'reply_2'])).toBe('reply_3')
  })

  it('una oficial no manda configuración interactiva ni una interna datos de Meta', () => {
    expect(payloadFromForm(official({ interactiveType: 'button' }))).toMatchObject({ interactive_type: 'none', interactive_config: {}, official_name: 'aviso_de_cita' })
    expect(payloadFromForm(form({ officialFooter: 'pie', officialButtons: [{ type: 'quick_reply', text: 'Sí' }] })))
      .toMatchObject({ official_name: null, official_footer: null, official_buttons: [], official_parameter_values: [] })
  })

  it('una plantilla nueva arranca en la categoría preferida si existe', () => {
    expect(emptyTemplateForm([{ name: 'ventas' }, { name: 'Seguimiento' }]).category).toBe('Seguimiento')
    expect(emptyTemplateForm([{ name: 'ventas' }]).category).toBe('ventas')
  })
})

describe('datos de una oficial', () => {
  it('insertar un dato pone la siguiente variable y la deja unida a ese dato', () => {
    const next = insertDataVariable({ selectionStart: 5, selectionEnd: 5 }, 'Hola , tu cita es el {{1}}.', ['{{cita.fecha}}'], 'nombre')
    expect(next.content).toBe('Hola {{2}}, tu cita es el {{1}}.')
    expect(next.values).toEqual(['{{cita.fecha}}', '{{nombre}}'])
    expect(next.caret).toBe(10)
  })

  it('al cambiar el texto se conservan los datos ya elegidos', () => {
    expect(resizeParameters('{{1}} y {{2}} y {{3}}', ['{{nombre}}'])).toEqual(['{{nombre}}', '', ''])
    expect(resizeParameters('sin datos', ['{{nombre}}'])).toEqual([])
  })

  it('distingue un dato solo de una mezcla con texto', () => {
    expect(singleSource('{{cita.hora}}')).toBe('cita.hora')
    expect(singleSource('Dra. {{nombre}}')).toBeNull()
    expect(singleSource('{{inventado}}')).toBeNull()
  })

  it('negrita envuelve la selección', () => {
    expect(wrapSelection({ selectionStart: 5, selectionEnd: 9 }, 'Hola Hifu hoy', '*')).toEqual({ value: 'Hola *Hifu* hoy', selectionStart: 6, selectionEnd: 10 })
  })
})

describe('revisión antes de enviar a Meta', () => {
  const failing = (overrides: Partial<TemplateFormState>, others: string[] = []) =>
    preSendChecks(official(overrides), others).filter(check => !check.ok).map(check => check.id)

  it('una plantilla bien armada pasa todo', () => {
    expect(failing({})).toEqual([])
  })

  it('avisa si el texto empieza o termina con un dato, aunque lleve negrita', () => {
    expect(failing({ content: '*{{1}}*, tu cita quedó registrada para mañana.' })).toContain('edges')
    expect(failing({ content: 'Tu cita quedó registrada a nombre de {{1}}' })).toContain('edges')
  })

  it('avisa de dos datos pegados y de un texto que es casi solo datos', () => {
    expect(failing({ content: 'Hola {{1}} {{2}}, gracias por venir a la clínica.', officialParameterValues: ['{{nombre}}', '{{servicio}}'] })).toContain('adjacent')
    expect(failing({ content: 'Hola {{1}}, {{2}} hoy.', officialParameterValues: ['{{nombre}}', '{{servicio}}'] })).toContain('ratio')
  })

  it('avisa de un dato sin elegir y de un texto repetido', () => {
    expect(failing({ officialParameterValues: [''] })).toContain('examples')
    expect(failing({}, ['hola {{9}},   tu cita quedó *registrada*.'])).toContain('duplicate')
  })
})

describe('vista previa', () => {
  it('una oficial muestra los ejemplos que revisa Meta', () => {
    const preview = previewOf(official({ officialFooter: ' DermicaPro ', officialButtons: [{ type: 'quick_reply', text: 'Confirmar' }, { type: 'quick_reply', text: '' }] }), { withData: true })
    expect(preview.body).toBe('Hola Ana, tu cita quedó registrada.')
    expect(preview.footer).toBe('DermicaPro')
    expect(preview.buttons).toEqual([{ key: 'reply:Confirmar', text: 'Confirmar', kind: 'reply' }])
  })

  it('sin datos deja el hueco vacío, como le llega a un lead sin nombre', () => {
    expect(previewOf(form({ content: 'Hola {{nombre}}.' }), { withData: false }).body).toBe('Hola .')
    expect(internalVariablesIn('Hola {{nombre}}, sobre {{servicio}}')).toEqual(['Nombre', 'Servicio de interés'])
  })

  it('dos botones iguales a medio escribir no comparten clave', () => {
    const preview = previewOf(form({ interactiveType: 'button', interactiveButtons: [{ id: 'a', title: 'Sí' }, { id: 'b', title: 'Sí' }] }), { withData: true })
    expect(preview.buttons.map(button => button.key)).toEqual(['reply:Sí', 'reply:Sí#1'])
  })

  it('con lista usa el pie por defecto del negocio', () => {
    const preview = previewOf(form({ interactiveType: 'list', interactiveButtonText: 'Ver tratamientos' }), { withData: true, defaultFooter: 'DermicaPro' })
    expect(preview.footer).toBe('DermicaPro')
    expect(preview.buttons).toEqual([{ key: 'list:Ver tratamientos', text: 'Ver tratamientos', kind: 'list' }])
  })
})

describe('lista', () => {
  const template = (overrides: Partial<MessageTemplate>) => ({
    id: 1, name: 'Saludo', content: 'Hola', shortcut: null, category: 'ventas', template_type: 'internal',
    official_status: null, official_name: null, is_active: true, use_count: 0, ...overrides,
  }) as MessageTemplate
  const all = [
    template({ id: 1, name: 'slogan hifu12d', shortcut: 'hifu-12d', use_count: 2938 }),
    template({ id: 2, name: 'aviso_cita_cliente', template_type: 'official', official_status: 'APPROVED', category: 'Seguimiento', use_count: 1 }),
    template({ id: 3, name: 'Promo', template_type: 'official', official_status: 'REJECTED', content: 'Promoción de botox' }),
    template({ id: 4, name: 'Vieja', is_active: false, use_count: 9000 }),
  ]

  it('traduce el estado de Meta y el motivo de rechazo', () => {
    expect(officialStatus('APPROVED')).toMatchObject({ label: 'Aprobada', tone: 'success' })
    expect(officialStatus('PENDING')).toMatchObject({ label: 'En revisión', kind: 'review' })
    expect(officialStatus(null).kind).toBe('unsent')
    expect(rejectedReason('TAG_CONTENT_MISMATCH')).toBe('El texto no coincide con el tipo de mensaje elegido')
  })

  it('busca por nombre, texto o atajo, sin distinguir acentos', () => {
    const ids = (query: string) => filterTemplates(all, { ...NO_FILTERS, query }).map(item => item.id)
    expect(ids('/hifu')).toEqual([1])
    expect(ids('promocion')).toEqual([3])
  })

  it('filtra por tipo, estado y categoría, y ordena por uso', () => {
    expect(filterTemplates(all, { ...NO_FILTERS, status: 'rejected' }).map(item => item.id)).toEqual([3])
    expect(filterTemplates(all, { ...NO_FILTERS, status: 'inactive' }).map(item => item.id)).toEqual([4])
    expect(filterTemplates(all, { ...NO_FILTERS, type: 'official', category: 'Seguimiento' }).map(item => item.id)).toEqual([2])
    expect(sortByUse(all).map(item => item.id)).toEqual([4, 1, 2, 3])
  })
})

describe('lo que Meta deja cambiar en una plantilla ya enviada', () => {
  const sent = (official_status: string | null, overrides: Partial<MessageTemplate> = {}) =>
    ({ template_type: 'official', meta_template_id: '900', official_status, ...overrides }) as MessageTemplate

  it('una aprobada admite cambios al mensaje, con cupo, pero no de tipo', () => {
    expect(metaEditRules(sent('APPROVED'))).toEqual({ contentLocked: false, categoryLocked: true, limited: true, editableFrom: null })
  })

  it('en revisión o deshabilitada no admite cambios al mensaje ni al tipo', () => {
    expect(metaEditRules(sent('PENDING'))).toEqual({ contentLocked: true, categoryLocked: true, limited: false, editableFrom: null })
    expect(metaEditRules(sent('DISABLED'))).toMatchObject({ contentLocked: true, categoryLocked: true })
  })

  it('rechazada o pausada se corrige sin restricciones', () => {
    expect(metaEditRules(sent('REJECTED'))).toEqual({ contentLocked: false, categoryLocked: false, limited: false, editableFrom: null })
    expect(metaEditRules(sent('PAUSED'))).toEqual({ contentLocked: false, categoryLocked: false, limited: false, editableFrom: null })
  })

  it('una interna, una nueva o una oficial que Meta todavía no tiene no llevan restricciones', () => {
    const free = { contentLocked: false, categoryLocked: false, limited: false, editableFrom: null }
    expect(metaEditRules(undefined)).toEqual(free)
    expect(metaEditRules(sent('APPROVED', { template_type: 'internal' }))).toEqual(free)
    expect(metaEditRules(sent('APPROVED', { meta_template_id: null }))).toEqual(free)
  })

  it('una aprobada con el cupo gastado bloquea el mensaje hasta que Meta acepte otro cambio', () => {
    const now = Date.parse('2026-11-23T18:17:00Z')
    const next = '2026-11-24T18:12:22Z'
    const rules = metaEditRules(sent('APPROVED', { official_next_edit_at: next }), now)
    expect(rules).toEqual({ contentLocked: true, categoryLocked: true, limited: true, editableFrom: Date.parse(next) })
    expect(metaEditBlock(rules, { content: true, category: false })).toMatch(/todavía no acepta otro cambio/)
    // Pasada la hora ya no hay que esperar, aunque la lista siga abierta.
    expect(metaEditRules(sent('APPROVED', { official_next_edit_at: next }), Date.parse(next) + 1).contentLocked).toBe(false)
    // El cupo es de las aprobadas: una rechazada no espera.
    expect(metaEditRules(sent('REJECTED', { official_next_edit_at: next }), now).editableFrom).toBeNull()
  })

  it('frena el guardado solo si trae un cambio que Meta va a rechazar', () => {
    const approved = metaEditRules(sent('APPROVED'))
    const pending = metaEditRules(sent('PENDING'))
    expect(metaEditBlock(approved, { content: true, category: false })).toBeNull()
    expect(metaEditBlock(approved, { content: false, category: true })).toMatch(/tipo de mensaje de una plantilla aprobada/)
    expect(metaEditBlock(pending, { content: true, category: false })).toMatch(/mientras está en revisión/)
    expect(metaEditBlock(pending, { content: false, category: false })).toBeNull()
  })
})

describe('respaldo local del borrador', () => {
  beforeEach(() => localStorage.clear())

  it('guarda, recupera y borra el borrador de una plantilla nueva', () => {
    expect(loadTemplateDraft(null)).toBeNull()
    saveTemplateDraft(null, { form: form({ name: 'A medias' }), officialNameEdited: false, savedAt: 1000 })
    expect(loadTemplateDraft(null)).toMatchObject({ form: { name: 'A medias' }, savedAt: 1000 })
    expect(loadTemplateDraft(7)).toBeNull()
    clearTemplateDraft(null)
    expect(loadTemplateDraft(null)).toBeNull()
  })

  it('ignora un respaldo roto o de otra versión', () => {
    localStorage.setItem('template-editor-draft:new', '{no es json')
    expect(loadTemplateDraft(null)).toBeNull()
    localStorage.setItem('template-editor-draft:new', JSON.stringify({ version: 0, form: {}, savedAt: 1 }))
    expect(loadTemplateDraft(null)).toBeNull()
  })

  it('lista las plantillas guardadas que tienen cambios sin enviar', () => {
    saveTemplateDraft(null, { form: form({ name: 'Nueva' }), officialNameEdited: false, savedAt: 1 })
    saveTemplateDraft(21, { form: form({ name: 'Desde Instagram' }), officialNameEdited: true, savedAt: 2 })
    localStorage.setItem('template-editor-draft:9', 'roto')
    expect(templateIdsWithDraft()).toEqual([21])
  })

  it('dice un momento como lo diría una persona', () => {
    const now = new Date(2026, 10, 23, 13, 17).getTime()
    expect(whenLabel(new Date(2026, 10, 23, 13, 12).getTime(), now)).toBe('hoy a las 13:12')
    expect(whenLabel(new Date(2026, 10, 24, 13, 12).getTime(), now)).toBe('mañana a las 13:12')
    expect(whenLabel(new Date(2026, 10, 22, 9, 5).getTime(), now)).toBe('ayer a las 09:05')
    expect(whenLabel(new Date(2026, 11, 2, 13, 12).getTime(), now)).toBe('el 2 de diciembre a las 13:12')
  })

  it('dice de cuándo es', () => {
    expect(elapsedLabel(0, 20_000)).toBe('hace un momento')
    expect(elapsedLabel(0, 20 * 60_000)).toBe('hace 20 min')
    expect(elapsedLabel(0, 3 * 3_600_000)).toBe('hace 3 h')
  })
})
