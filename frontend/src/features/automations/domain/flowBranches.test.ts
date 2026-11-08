import { describe, expect, it } from 'vitest'
import { FlowHandle, QuestionHandle, WaitAnyConditionKind } from './automationCatalog'
import { flowBranchName, followedBranchText } from './flowBranches'

describe('flowBranchName', () => {
  it('names every fixed exit with the text the canvas shows', () => {
    expect(flowBranchName(FlowHandle.Yes)).toBe('Sí')
    expect(flowBranchName(FlowHandle.No)).toBe('Ninguna de las condiciones')
    expect(flowBranchName(WaitAnyConditionKind.Timer)).toBe('Temporizador')
    expect(flowBranchName(WaitAnyConditionKind.Message)).toBe('Respondió con un mensaje')
    expect(flowBranchName(WaitAnyConditionKind.MediaReceived)).toBe('Mandó una foto o archivo')
    expect(flowBranchName(WaitAnyConditionKind.MediaPlayed)).toBe('Vio o escuchó lo enviado')
    expect(flowBranchName(WaitAnyConditionKind.BusinessHours)).toBe('Fuera del horario laboral')
    expect(flowBranchName(QuestionHandle.Other)).toBe('Otra respuesta')
    expect(flowBranchName(QuestionHandle.Timeout)).toBe('Sin respuesta')
    expect(flowBranchName(QuestionHandle.Media)).toBe('Mandó una foto')
  })

  it('leaves per-block exits unnamed: without the flow they are only codes', () => {
    expect(flowBranchName('btn_1')).toBeNull()
    expect(flowBranchName('out_2')).toBeNull()
    expect(flowBranchName('group-4f2a')).toBeNull()
    expect(flowBranchName('toString')).toBeNull()
    expect(flowBranchName(undefined)).toBeNull()
  })
})

describe('followedBranchText', () => {
  it('quotes the exit name when it has one', () => {
    expect(followedBranchText('timeout')).toBe('siguió por «Sin respuesta»')
  })

  it('does not show a code when the exit has no fixed name', () => {
    expect(followedBranchText('btn_2')).toBe('siguió por una de sus salidas')
  })
})
