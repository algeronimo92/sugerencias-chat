import { useReducer } from 'react'
import type { AutomationFlowDefinition, AutomationRule } from '../types'

export type FlowEditorDialog = 'simulation' | 'versions' | 'jsonView' | 'importJson' | 'exitConfirmation'
export type FlowJsonTab = 'draft' | 'published'

export interface FlowEditorState {
  ruleId: number | null
  /** Última definición confirmada por el backend: `null` mientras el borrador
   * tenga cambios sin guardar. */
  savedDefinition: AutomationFlowDefinition | null
  savedName: string | null
  publishedDefinition: AutomationFlowDefinition | null
  name: string
  maxPerHour: number | null
  visibleToSellers: boolean
  selectedId: string | null
  showEntryConditions: boolean
  error: string | null
  notice: string | null
  openDialogs: Record<FlowEditorDialog, boolean>
  jsonViewTab: FlowJsonTab
  jsonCopied: boolean
}

export type FlowEditorAction =
  | { type: 'select'; nodeId: string | null }
  | { type: 'deselectRemoved'; removedIds: Set<string> }
  | { type: 'fail'; message: string }
  | { type: 'notify'; message: string }
  | { type: 'clearFeedback' }
  | { type: 'draftSaved'; ruleId: number; name: string; definition: AutomationFlowDefinition | null }
  | { type: 'published'; definition: AutomationFlowDefinition | null; version: number }
  | { type: 'versionRestored'; version: number }
  | { type: 'rename'; name: string }
  | { type: 'maxPerHourChanged'; value: number | null }
  | { type: 'visibleToSellersChanged'; value: boolean }
  | { type: 'toggleEntryConditions' }
  | { type: 'openDialog'; dialog: FlowEditorDialog }
  | { type: 'closeDialog'; dialog: FlowEditorDialog }
  | { type: 'jsonTabChanged'; tab: FlowJsonTab }
  | { type: 'jsonCopied'; copied: boolean }

const NO_DIALOGS: Record<FlowEditorDialog, boolean> = {
  simulation: false,
  versions: false,
  jsonView: false,
  importJson: false,
  exitConfirmation: false,
}

export function initialFlowEditorState(
  rule: AutomationRule | undefined,
  initialDefinition: AutomationFlowDefinition | null,
  publishedDefinition: AutomationFlowDefinition | null,
  firstNodeId: string | null,
): FlowEditorState {
  return {
    ruleId: rule?.id ?? null,
    savedDefinition: initialDefinition,
    savedName: rule?.name ?? null,
    publishedDefinition,
    name: rule?.name ?? 'Nuevo flujo visual',
    maxPerHour: rule?.max_executions_per_hour ?? null,
    visibleToSellers: rule?.visible_to_sellers ?? false,
    selectedId: firstNodeId,
    showEntryConditions: false,
    error: null,
    notice: null,
    openDialogs: NO_DIALOGS,
    jsonViewTab: 'draft',
    jsonCopied: false,
  }
}

export function flowEditorReducer(state: FlowEditorState, action: FlowEditorAction): FlowEditorState {
  switch (action.type) {
    case 'select':
      // Elegir un bloque cierra las condiciones de entrada: el panel lateral
      // es uno solo y muestra las propiedades del bloque elegido.
      return {
        ...state,
        selectedId: action.nodeId,
        showEntryConditions: action.nodeId ? false : state.showEntryConditions,
        error: null,
      }
    case 'deselectRemoved':
      return state.selectedId && action.removedIds.has(state.selectedId)
        ? { ...state, selectedId: null }
        : state
    case 'fail':
      return { ...state, error: action.message, notice: null }
    case 'notify':
      return { ...state, notice: action.message, error: null }
    case 'clearFeedback':
      return { ...state, error: null, notice: null }
    case 'draftSaved':
      return {
        ...state,
        ruleId: action.ruleId,
        savedName: action.name,
        savedDefinition: action.definition,
        notice: 'Borrador guardado.',
        error: null,
      }
    case 'published':
      return {
        ...state,
        publishedDefinition: action.definition,
        notice: `Flujo publicado · versión ${action.version}.`,
        error: null,
      }
    case 'versionRestored':
      return {
        ...state,
        selectedId: null,
        notice: `Versión ${action.version} cargada como borrador. Revísala y publica para aplicarla.`,
        error: null,
      }
    case 'rename':
      return { ...state, name: action.name }
    case 'maxPerHourChanged':
      return { ...state, maxPerHour: action.value }
    case 'visibleToSellersChanged':
      return { ...state, visibleToSellers: action.value }
    case 'toggleEntryConditions':
      return { ...state, showEntryConditions: !state.showEntryConditions }
    case 'openDialog':
      // El JSON se abre siempre en la pestaña del borrador y sin el "copiado"
      // de la vez anterior.
      return {
        ...state,
        openDialogs: { ...state.openDialogs, [action.dialog]: true },
        jsonViewTab: action.dialog === 'jsonView' ? 'draft' : state.jsonViewTab,
        jsonCopied: action.dialog === 'jsonView' ? false : state.jsonCopied,
      }
    case 'closeDialog':
      return { ...state, openDialogs: { ...state.openDialogs, [action.dialog]: false } }
    case 'jsonTabChanged':
      return { ...state, jsonViewTab: action.tab }
    case 'jsonCopied':
      return { ...state, jsonCopied: action.copied }
  }
}

export function useFlowEditor(
  rule: AutomationRule | undefined,
  initialDefinition: AutomationFlowDefinition | null,
  publishedDefinition: AutomationFlowDefinition | null,
  firstNodeId: string | null,
) {
  return useReducer(
    flowEditorReducer,
    undefined,
    () => initialFlowEditorState(rule, initialDefinition, publishedDefinition, firstNodeId),
  )
}
