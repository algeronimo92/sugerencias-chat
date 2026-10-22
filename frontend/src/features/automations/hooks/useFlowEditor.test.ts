import { describe, expect, it } from 'vitest'
import { flowEditorReducer, initialFlowEditorState, type FlowEditorState } from './useFlowEditor'

const DEFINITION = { conditions: {}, nodes: [], edges: [] }

function stateWith(overrides: Partial<FlowEditorState> = {}): FlowEditorState {
  return { ...initialFlowEditorState(undefined, null, null, 'trigger-1'), ...overrides }
}

describe('flowEditorReducer', () => {
  it('parte del flujo recibido o de un borrador nuevo', () => {
    const empty = initialFlowEditorState(undefined, null, null, null)
    const existing = initialFlowEditorState(
      { id: 4, name: 'Bienvenida', max_executions_per_hour: 10, visible_to_sellers: true } as never,
      DEFINITION,
      DEFINITION,
      'trigger-1',
    )

    expect(empty).toMatchObject({ ruleId: null, name: 'Nuevo flujo visual', savedDefinition: null, selectedId: null })
    expect(existing).toMatchObject({ ruleId: 4, name: 'Bienvenida', maxPerHour: 10, visibleToSellers: true, selectedId: 'trigger-1', publishedDefinition: DEFINITION })
  })

  it('elegir un bloque cierra las condiciones de entrada y limpia el error', () => {
    const state = stateWith({ showEntryConditions: true, error: 'algo falló' })

    expect(flowEditorReducer(state, { type: 'select', nodeId: 'n1' }))
      .toMatchObject({ selectedId: 'n1', showEntryConditions: false, error: null })
  })

  it('deseleccionar no cierra las condiciones de entrada', () => {
    const state = stateWith({ showEntryConditions: true })

    expect(flowEditorReducer(state, { type: 'select', nodeId: null }).showEntryConditions).toBe(true)
  })

  it('borrar bloques solo deselecciona si el elegido era uno de ellos', () => {
    const state = stateWith({ selectedId: 'n1' })

    expect(flowEditorReducer(state, { type: 'deselectRemoved', removedIds: new Set(['n2']) }).selectedId).toBe('n1')
    expect(flowEditorReducer(state, { type: 'deselectRemoved', removedIds: new Set(['n1']) }).selectedId).toBeNull()
  })

  it('un aviso y un error nunca conviven', () => {
    const failed = flowEditorReducer(stateWith({ notice: 'Borrador guardado.' }), { type: 'fail', message: 'boom' })
    const notified = flowEditorReducer(failed, { type: 'notify', message: 'listo' })

    expect(failed).toMatchObject({ error: 'boom', notice: null })
    expect(notified).toMatchObject({ error: null, notice: 'listo' })
  })

  it('guardar el borrador registra la regla y su definición confirmada', () => {
    const saved = flowEditorReducer(stateWith({ error: 'previo' }), {
      type: 'draftSaved', ruleId: 7, name: 'Flujo', definition: DEFINITION,
    })

    expect(saved).toMatchObject({ ruleId: 7, savedName: 'Flujo', savedDefinition: DEFINITION, notice: 'Borrador guardado.', error: null })
  })

  it('publicar guarda la versión publicada y lo dice', () => {
    const published = flowEditorReducer(stateWith(), { type: 'published', definition: DEFINITION, version: 3 })

    expect(published).toMatchObject({ publishedDefinition: DEFINITION, notice: 'Flujo publicado · versión 3.' })
  })

  it('restaurar una versión deselecciona el bloque abierto', () => {
    const restored = flowEditorReducer(stateWith({ selectedId: 'n1' }), { type: 'versionRestored', version: 2 })

    expect(restored.selectedId).toBeNull()
    expect(restored.notice).toContain('Versión 2')
  })

  it('abrir el JSON siempre arranca en el borrador y sin el "copiado" anterior', () => {
    const state = stateWith({ jsonViewTab: 'published', jsonCopied: true })

    const opened = flowEditorReducer(state, { type: 'openDialog', dialog: 'jsonView' })

    expect(opened).toMatchObject({ jsonViewTab: 'draft', jsonCopied: false })
    expect(opened.openDialogs.jsonView).toBe(true)
  })

  it('abrir y cerrar un diálogo no toca a los demás', () => {
    const opened = flowEditorReducer(stateWith(), { type: 'openDialog', dialog: 'versions' })
    const withTwo = flowEditorReducer(opened, { type: 'openDialog', dialog: 'simulation' })
    const closed = flowEditorReducer(withTwo, { type: 'closeDialog', dialog: 'versions' })

    expect(closed.openDialogs).toMatchObject({ versions: false, simulation: true, jsonView: false })
  })
})
