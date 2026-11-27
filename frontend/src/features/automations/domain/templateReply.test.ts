import { describe, expect, it } from 'vitest'
import type { MessageTemplate } from '../../templates/types'
import type { AutomationAction, AutomationFlowEdge, TemplateReply } from '../types'
import { DEFAULT_REPLY_TIMEOUT_SECONDS, edgesAfterReplyChange, newTemplateReply, replyAfterActionChange, replyIsOutdated, templateQuickReplies } from './templateReply'

const meta = (id: number, ...texts: string[]) => ({
  id, template_type: 'official', official_buttons: texts.map(text => ({ type: 'quick_reply', text })),
}) as MessageTemplate

const edge = (handle: string, source = 'plantilla'): AutomationFlowEdge => ({ id: `${source}-${handle}`, source, target: `fin-${handle}`, source_handle: handle })
const handles = (edges: AutomationFlowEdge[]) => edges.map(item => `${item.source}:${item.source_handle}`)
const template = (id: number | null): AutomationAction => ({ type: 'send_template', template_id: id })

describe('templateQuickReplies', () => {
  it('solo cuenta los botones de respuesta rápida de una plantilla de Meta', () => {
    expect(templateQuickReplies(meta(1, 'Sí, quiero', 'No, gracias'))).toEqual(['Sí, quiero', 'No, gracias'])
    expect(templateQuickReplies({ template_type: 'official', official_buttons: [{ type: 'url', text: 'Ver', url: 'https://x.pe' }] })).toEqual([])
    expect(templateQuickReplies({ template_type: 'internal', official_buttons: [{ type: 'quick_reply', text: 'Sí' }] })).toEqual([])
    expect(templateQuickReplies(null)).toEqual([])
  })
})

describe('newTemplateReply', () => {
  it('numera los botones como una Pregunta y espera 24 horas por defecto', () => {
    expect(newTemplateReply(['Sí', 'No'])).toEqual({
      buttons: [{ id: 'btn_1', label: 'Sí' }, { id: 'btn_2', label: 'No' }],
      timeout_seconds: DEFAULT_REPLY_TIMEOUT_SECONDS,
    })
    expect(DEFAULT_REPLY_TIMEOUT_SECONDS).toBe(24 * 3600)
  })
})

describe('replyIsOutdated', () => {
  const reply = newTemplateReply(['Sí', 'No'])

  it('no lo está mientras la plantilla tenga los mismos botones en el mismo orden', () => {
    expect(replyIsOutdated(reply, ['Sí', 'No'])).toBe(false)
  })

  it('lo está si la plantilla perdió, cambió o reordenó un botón', () => {
    expect(replyIsOutdated(reply, ['Sí'])).toBe(true)
    expect(replyIsOutdated(reply, ['Sí', 'Ahora no'])).toBe(true)
    expect(replyIsOutdated(reply, ['No', 'Sí'])).toBe(true)
  })
})

describe('replyAfterActionChange', () => {
  const templates = [meta(1, 'Sí', 'No'), meta(2, 'Confirmar'), meta(3)]
  const reply: TemplateReply = newTemplateReply(['Sí', 'No'], 7200)

  it('apagado sigue apagado, se elija la plantilla que se elija', () => {
    expect(replyAfterActionChange(undefined, template(1), template(2), templates)).toBeUndefined()
  })

  it('se conserva mientras no cambie la plantilla', () => {
    expect(replyAfterActionChange(reply, template(1), template(1), templates)).toBe(reply)
  })

  it('toma los botones de la plantilla nueva y conserva el tiempo de espera', () => {
    expect(replyAfterActionChange(reply, template(1), template(2), templates)).toEqual(newTemplateReply(['Confirmar'], 7200))
  })

  it('se apaga si la plantilla nueva no tiene respuestas rápidas o la acción deja de ser una plantilla', () => {
    expect(replyAfterActionChange(reply, template(1), template(3), templates)).toBeUndefined()
    expect(replyAfterActionChange(reply, template(1), { type: 'send_message', text: 'Hola' }, templates)).toBeUndefined()
  })
})

describe('edgesAfterReplyChange', () => {
  const other = edge('next', 'otro')

  it('sin el ajuste antes ni después no toca nada', () => {
    const edges = [edge('next'), other]
    expect(edgesAfterReplyChange(edges, 'plantilla', undefined, undefined)).toBe(edges)
  })

  it('al encenderlo quita «Siguiente»: el paso ya no tiene esa salida', () => {
    expect(handles(edgesAfterReplyChange([edge('next'), other], 'plantilla', undefined, newTemplateReply(['Sí'])))).toEqual(['otro:next'])
  })

  it('al apagarlo quita las conexiones de los botones, «Otra respuesta» y «Sin respuesta»', () => {
    const edges = [edge('btn_1'), edge('other'), edge('timeout'), other]
    expect(handles(edgesAfterReplyChange(edges, 'plantilla', newTemplateReply(['Sí']), undefined))).toEqual(['otro:next'])
  })

  it('al cambiar de plantilla un botón con otro texto no hereda la ruta del que ocupaba su lugar', () => {
    const edges = [edge('btn_1'), edge('btn_2'), edge('btn_3'), edge('other'), edge('timeout'), other]
    const next = edgesAfterReplyChange(edges, 'plantilla', newTemplateReply(['Sí', 'No', 'Tal vez']), newTemplateReply(['Sí', 'Reprogramar']))
    expect(handles(next)).toEqual(['plantilla:btn_1', 'plantilla:other', 'plantilla:timeout', 'otro:next'])
  })

  it('un botón que cambió de lugar conserva su ruta, con su número nuevo', () => {
    // Quitaron «No»: «Tal vez» pasa de btn_3 a btn_2 y sigue yendo a su destino.
    const edges = [edge('btn_1'), edge('btn_2'), edge('btn_3'), edge('timeout')]
    const next = edgesAfterReplyChange(edges, 'plantilla', newTemplateReply(['Sí', 'No', 'Tal vez']), newTemplateReply(['Sí', 'Tal vez']))
    expect(next.map(item => `${item.source_handle}→${item.target}`)).toEqual(['btn_1→fin-btn_1', 'btn_2→fin-btn_3', 'timeout→fin-timeout'])
  })

  it('si dos botones intercambian su lugar, cada conexión sigue a su texto', () => {
    const next = edgesAfterReplyChange([edge('btn_1'), edge('btn_2')], 'plantilla', newTemplateReply(['Sí', 'No']), newTemplateReply(['No', 'Sí']))
    expect(next.map(item => `${item.source_handle}→${item.target}`)).toEqual(['btn_2→fin-btn_1', 'btn_1→fin-btn_2'])
  })

  it('cambiar solo el tiempo de espera no quita ninguna conexión', () => {
    const edges = [edge('btn_1'), edge('other'), edge('timeout')]
    expect(edgesAfterReplyChange(edges, 'plantilla', newTemplateReply(['Sí']), newTemplateReply(['Sí'], 60))).toEqual(edges)
  })
})
