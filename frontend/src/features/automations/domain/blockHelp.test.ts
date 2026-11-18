import { describe, expect, it } from 'vitest'
import { AutomationActionType, FlowNodeType } from './automationCatalog'
import { blockHelp, TEXT_ACTIONS } from './blockHelp'

describe('blockHelp', () => {
  it('explica los bloques con salidas que hay que conectar', () => {
    for (const type of [FlowNodeType.Condition, FlowNodeType.WaitAny, FlowNodeType.Question, FlowNodeType.RoundRobin]) {
      expect(blockHelp(type).length).toBeGreaterThan(0)
    }
  })

  it('avisa la ventana de 24 h en todo bloque que manda un mensaje', () => {
    const sends = [
      AutomationActionType.SendTemplate, AutomationActionType.SendMessage, AutomationActionType.SendAudio,
      AutomationActionType.SendAttachment, AutomationActionType.SendMedia,
    ]
    for (const action of sends) {
      expect(blockHelp(FlowNodeType.Action, action).join(' ')).toMatch(/24 horas/)
    }
    expect(blockHelp(FlowNodeType.Question).join(' ')).toMatch(/24 horas/)
  })

  it('no muestra el botón en bloques que no necesitan explicación', () => {
    expect(blockHelp(FlowNodeType.Wait)).toEqual([])
    expect(blockHelp(FlowNodeType.Action, AutomationActionType.AddTag)).toEqual([])
  })

  it('ofrece las variables solo en acciones con texto', () => {
    expect(TEXT_ACTIONS.has(AutomationActionType.SendMessage)).toBe(true)
    expect(TEXT_ACTIONS.has(AutomationActionType.AddTag)).toBe(false)
  })
})
