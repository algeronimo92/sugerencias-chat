import { describe, expect, it } from 'vitest'
import { searchableText, searchFlowNodes, type FlowNodeSearchItem } from './flowNodeSearch'

const items: FlowNodeSearchItem[] = [
  { id: 'a', number: 1, title: 'Inicio manual (vendedor)', text: '' },
  { id: 'b', number: 2, title: 'Cambiar/quitar servicio de interés', text: 'Hollywood Peel' },
  { id: 'c', number: 12, title: 'Enviar mensaje directo', text: 'Promoción de verano para {{nombre}}' },
  { id: 'd', number: 21, title: 'Pregunta', text: '¿Agendamos tu evaluación? Sí No' },
]

describe('searchFlowNodes', () => {
  it('por número: exacto primero, después los que empiezan igual', () => {
    expect(searchFlowNodes(items, '#2').map(item => item.number)).toEqual([2, 21])
    expect(searchFlowNodes(items, '12').map(item => item.id)).toEqual(['c'])
  })

  it('por texto, sin mayúsculas ni tildes, primero en el título', () => {
    expect(searchFlowNodes(items, 'promocion').map(item => item.id)).toEqual(['c'])
    expect(searchFlowNodes(items, 'HOLLYWOOD').map(item => item.id)).toEqual(['b'])
    expect(searchFlowNodes(items, 'interes').map(item => item.id)).toEqual(['b'])
    expect(searchFlowNodes(items, 'evaluación').map(item => item.id)).toEqual(['d'])
    expect(searchFlowNodes(items, '   ')).toEqual([])
  })
})

describe('searchableText', () => {
  it('junta lo que se escribió en el bloque, sin identificadores internos', () => {
    const text = searchableText({ action: { type: 'send_message', text: 'Hola' }, buttons: [{ id: 'btn_1', label: 'Sí' }] })
    expect(text).toContain('Hola')
    expect(text).toContain('Sí')
    expect(text).not.toContain('send_message')
    expect(text).not.toContain('btn_1')
  })
})
