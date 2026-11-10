import { describe, expect, it } from 'vitest'
import { AutomationActionType, FlowNodeType } from './automationCatalog'
import { FLOW_TONES, flowTone, minimapFill, numberScale } from './flowTones'

describe('flowTone', () => {
  it('distingue Mensaje de Acción: antes se veían iguales', () => {
    expect(flowTone(FlowNodeType.Action, AutomationActionType.SendTemplate)).toBe('message')
    expect(flowTone(FlowNodeType.Action, AutomationActionType.AddTag)).toBe('action')
  })

  it('ningún tipo usa ámbar ni rojo: quedan para "revisar" y para errores', () => {
    const classes = Object.values(FLOW_TONES).flatMap(tone => [tone.border, tone.icon]).join(' ')
    expect(classes).not.toMatch(/amber|red-|orange|yellow/)
  })

  it('cada tipo con color tiene uno propio, en claro y en oscuro', () => {
    const colored = Object.entries(FLOW_TONES).filter(([tone]) => tone !== 'neutral').map(([, style]) => style.fill)
    expect(new Set(colored.map(fill => fill[0])).size).toBe(colored.length)
    expect(new Set(colored.map(fill => fill[1])).size).toBe(colored.length)
  })
})

describe('minimapFill', () => {
  it('pinta el tipo y, si está marcado, ámbar', () => {
    expect(minimapFill(FlowNodeType.Question, undefined, false, true)).toBe(FLOW_TONES.question.fill[1])
    expect(minimapFill(FlowNodeType.Question, undefined, true, false)).toMatch(/^#f59e0b$/)
  })
})

describe('numberScale', () => {
  it('con el lienzo alejado el #n se agranda para verse de ~11 px', () => {
    expect(numberScale(1)).toBe(1.0)
    expect(numberScale(0.25) * 10 * 0.25).toBeGreaterThanOrEqual(10.5)
    expect(numberScale(0.2)).toBe(5.5)
    expect(numberScale(0.05)).toBe(6)
  })

  it('no achica al acercar ni falla sin zoom', () => {
    expect(numberScale(2)).toBe(1)
    expect(numberScale(0)).toBe(1)
  })
})
