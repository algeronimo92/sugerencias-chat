import {
Beaker,Braces,Check,
Copy,
History,LayoutGrid,
EyeOff,ListFilter,Loader2,LocateFixed,MessageSquareText,Play,Plus,Redo2,Save,Undo2,Upload,X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useActivityHold } from '../../../shared/activity'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { Select } from '../../../shared/ui/Input'
import { extractErrorMessage, extractErrorTarget } from '../../../shared/utils/errors'
import { CreateTemplateDialog } from '../../templates/public/CreateTemplateDialog'
import { META_CONTRACT } from '../../whatsapp/public/metaContract'
import { useTemplates } from '../../templates/public/useTemplates'
import type { MessageTemplate } from '../../templates/types'
import { conditionStageOptions, INITIAL_LEAD_STAGE, stageOptions } from '../../leads/public/leadStageMeta'
import { useTags } from '../../catalogs/public/useTags'
import { useLeadServices } from '../../catalogs/public/useLeadServices'
import { useLeadStageCatalog } from '../../leads/public/useLeadStages'
import type { Tag } from '../../catalogs/types'
import { AttachmentPreview, MediaAssetField } from '../../media/public/MediaAssetField'
import { useMediaLibrary } from '../../media/public/queries'
import type { MediaAsset } from '../../media/types'
import { useUsers } from '../../platform/public/useUsers'
import type { AppUser } from '../../platform/types'
import { AutomationActionType as ActionType, assertNever, AutomationBuilderMode, AutomationRecipient, FLOW_CONDITION_LABELS as CONDITION_LABELS, FlowConditionType as ConditionType, FlowHandle, isAutomationActionType, isAutomationTrigger, isFlowConditionType, MAX_ROUND_ROBIN_OUTPUTS, FlowNodeType as NodeType, QuestionHandle, RESPONSE_OVERDUE_TRIGGERS, AUTOMATION_TRIGGERS as TRIGGERS, AutomationTrigger as TriggerType, WAIT_ANY_CONDITION_LABELS, WaitAnyConditionKind } from '../domain/automationCatalog'
import { isTaskPriority, isTaskType, TASK_PRIORITY_OPTIONS, TASK_TYPE_OPTIONS as TASK_TYPES, TaskPriorityValue, TaskTypeValue } from '../../tasks/public/taskCatalog'
import { FLOW_NODE_VIEW, flowNodeSummary } from '../domain/flowNodeView'
import { useFlowEditor } from '../hooks/useFlowEditor'
import { actionNamesService, conditionsNameService, flowServiceReferences, flowServiceSummary, onlyPart } from '../domain/serviceReferences'
import { HIGHLIGHT_RING, ServiceHighlightNotice, type ServiceHighlight } from './ServiceHighlightNotice'
import { useFlowHistory } from '../hooks/useFlowHistory'
import {
useAutomationRuleSummaries,useCreateVisualFlow,useFlowVersions,usePublishVisualFlow,useRestoreFlowVersion,
useSaveVisualFlow,useSimulateVisualFlow,useUpdateAutomation,
type AutomationRuleSummary,
} from '../queries'
import type { AutomationAction, AutomationActionType, AutomationConditions, AutomationFlowConditionGroup, AutomationFlowConditionItem, AutomationFlowConditionType, AutomationFlowDefinition, AutomationFlowEdge, AutomationFlowNode, AutomationFlowNodeType, AutomationRule, QuestionButton, RoundRobinOutput, WaitAnyCondition } from '../types'
import { areFlowDefinitionsEqual } from '../utils/automationFlow'
import { AutomationReactionPicker } from './AutomationReactionPicker'
import { FlowCanvas } from './flow/FlowCanvas'
import { FlowNodeConnections, type FlowConnection } from './flow/FlowNodeConnections'
import { FLOW_PALETTE } from './flow/flowPalette'
import { FLOW_TONES, flowTone, MESSAGE_ICON } from '../domain/flowTones'
import { placeNewNode } from '../domain/flowPlacement'
import { FlowNodeSearch } from './flow/FlowNodeSearch'
import { FeedbackBar } from './flow/FeedbackBar'
import { FlowStatusPill } from './flow/FlowStatusPill'
import { PublishPausedDialog } from './flow/PublishPausedDialog'
import { searchableText } from '../domain/flowNodeSearch'
import { EDGE_LABELS } from './flow/flowCanvasEdges'
import { numberFlowNodes, reachableFromTrigger } from '../domain/flowNumbering'
import { INBOUND_MESSAGE_TYPE_OPTIONS } from '../domain/inboundMessageTypes'
import { FlowSimulationDialog } from './flow/FlowSimulationDialog'
import { ImportFlowJsonDialog } from './ImportFlowJsonDialog'
import { actionTypeOptions } from './actionTypeOptions'
import { SellerVisibilityField } from './flow/SellerVisibilityField'
const fieldClass = 'w-full rounded-lg border border-wa-border bg-white px-2.5 py-2 text-xs text-wa-text outline-none focus:border-wa-primary focus:ring-2 focus:ring-wa-primary/20 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark'

/** Condiciones que se comparan contra un texto libre que escribe el usuario.
 *  `MediaAnalysisContains` entra acá aunque no mire el mensaje del cliente
 *  sino la descripción que la IA generó del adjunto: la caja de texto es la
 *  misma, sólo cambia contra qué se compara. */
const MESSAGE_CONDITION_TYPES = new Set<AutomationFlowConditionType>([
  ConditionType.MessageContains,
  ConditionType.MessageEquals,
  ConditionType.MessageNotContains,
  ConditionType.MediaAnalysisContains,
])

const REPLY_ID_MAX_LENGTH = META_CONTRACT.limits.button_id

function defaultConditionValue(type: AutomationFlowConditionType): string | null {
  if (type === ConditionType.StageEquals) return 'nuevo'
  if (type === ConditionType.MessageTypeEquals) return INBOUND_MESSAGE_TYPE_OPTIONS[0].value
  if (MESSAGE_CONDITION_TYPES.has(type) || type === ConditionType.ReplyIdEquals) return ''
  return null
}

function conditionGroups(
  data: Extract<AutomationFlowNode, { type: typeof NodeType.Condition }>['data'],
  nodeId = 'condition',
): AutomationFlowConditionGroup[] {
  if (data.condition_groups?.length) return data.condition_groups
  return [{
    id: `${nodeId}-group-1`,
    conditions: [{
      id: `${nodeId}-rule-1`,
      condition_type: data.condition_type ?? ConditionType.StageEquals,
      value: data.value ?? 'nuevo',
    }],
  }]
}

function newConditionItem(type: AutomationFlowConditionType = ConditionType.MessageContains): AutomationFlowConditionItem {
  const id = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  return { id, condition_type: type, value: defaultConditionValue(type) }
}

function defaultAction(type: AutomationActionType): AutomationAction {
  switch (type) {
    case ActionType.CreateTask:
      return { type, title: 'Dar seguimiento a {{nombre}}', description: '', task_type: TaskTypeValue.FollowUp, priority: TaskPriorityValue.Normal, due_minutes: 60, remind_minutes_before: 15, assigned_user_id: null }
    case ActionType.AssignSeller:
      return { type, user_id: null }
    case ActionType.AddTag:
    case ActionType.RemoveTag:
      return { type, tag_id: null }
    case ActionType.ChangeStage:
      // La etapa inicial existe en todo negocio; el resto las define cada uno.
      return { type, stage: INITIAL_LEAD_STAGE }
    case ActionType.Notify:
      return { type, recipient: AutomationRecipient.Seller, user_id: null, title: 'Seguimiento pendiente', body: 'Revisa el lead {{nombre}}.' }
    case ActionType.SendTemplate:
      return { type, template_id: null }
    case ActionType.SendMessage:
      return { type, text: '' }
    case ActionType.ChangeService:
      return { type, service: null }
    case ActionType.SetConversationState:
      return { type, state: 'closed' }
    case ActionType.SendAudio:
      return { type, media_asset_id: null }
    case ActionType.SendAttachment:
      return { type, media_asset_id: null }
    case ActionType.SendMedia:
      return { type, media_asset_id: null, caption: '' }
    case ActionType.ReactToLastCustomerMessage:
      return { type, emoji: '❤️' }
    default:
      return assertNever(type)
  }
}

function initialFlow(): AutomationFlowDefinition {
  return {
    conditions: {},
    nodes: [
      { id: 'trigger-1', type: NodeType.Trigger, position: { x: 70, y: 220 }, data: { trigger_type: TriggerType.LeadCreated } },
      { id: 'action-1', type: NodeType.Action, position: { x: 390, y: 220 }, data: { action: defaultAction(ActionType.CreateTask) } },
      { id: 'end-1', type: NodeType.End, position: { x: 710, y: 220 }, data: { label: 'Fin', close_conversation: false } },
    ],
    edges: [
      { id: 'edge-trigger-1-action-1', source: 'trigger-1', target: 'action-1', source_handle: FlowHandle.Next },
      { id: 'edge-action-1-end-1', source: 'action-1', target: 'end-1', source_handle: FlowHandle.Next },
    ],
  }
}

function isFlowDefinition(value: AutomationRule['flow_definition'] | undefined): value is AutomationFlowDefinition {
  return value !== undefined && 'nodes' in value && 'edges' in value && Array.isArray(value.nodes) && Array.isArray(value.edges)
}

function withDefaultConditions(definition: AutomationFlowDefinition): AutomationFlowDefinition {
  const legacyWaitIds = new Set(
    definition.nodes.filter(node => node.type === NodeType.Wait).map(node => node.id),
  )
  const legacyConditionGroupIds = new Map(
    definition.nodes
      .filter((node): node is Extract<AutomationFlowNode, { type: typeof NodeType.Condition }> => (
        node.type === NodeType.Condition && !node.data.condition_groups?.length
      ))
      .map(node => [node.id, `${node.id}-group-1`]),
  )
  return {
    ...definition,
    conditions: definition.conditions ?? {},
    // Compatibilidad: las pausas antiguas (`wait`) se convierten al único
    // formato editable (`wait_any`) y su salida `next` pasa a ser `timer`.
    // También admite borradores aún más viejos que guardaban `minutes`.
    nodes: definition.nodes.map(node => {
      if (node.type === NodeType.Condition) {
        return { ...node, data: { condition_groups: conditionGroups(node.data, node.id) } }
      }
      if (node.type === NodeType.End) {
        return { ...node, data: { ...node.data, close_conversation: node.data.close_conversation === true } }
      }
      if (node.type !== NodeType.Wait) return node
      const data: { seconds?: number; minutes?: number } = node.data
      const seconds = data.seconds ?? (data.minutes ?? 30) * 60
      return {
        ...node,
        type: NodeType.WaitAny,
        data: { conditions: [{ id: WaitAnyConditionKind.Timer, kind: WaitAnyConditionKind.Timer, seconds }] },
      }
    }),
    edges: definition.edges.map(edge => {
      if (legacyWaitIds.has(edge.source)) {
        return { ...edge, source_handle: WaitAnyConditionKind.Timer }
      }
      const groupId = legacyConditionGroupIds.get(edge.source)
      if (groupId && edge.source_handle === FlowHandle.Yes) {
        return { ...edge, source_handle: groupId }
      }
      return edge
    }),
  }
}

function createFlowNode(type: AutomationFlowNodeType, id: string, x: number, y: number): AutomationFlowNode {
  const position = { x, y }
  switch (type) {
    case NodeType.Trigger:
      return { id, type, position, data: { trigger_type: TriggerType.LeadCreated } }
    case NodeType.Condition:
      return { id, type, position, data: { condition_groups: [{
        id: `${id}-group-1`,
        conditions: [{ id: `${id}-rule-1`, condition_type: ConditionType.StageEquals, value: 'nuevo' }],
      }] } }
    case NodeType.Action:
      return { id, type, position, data: { action: defaultAction(ActionType.CreateTask) } }
    case NodeType.InvokeFlow:
      return { id, type, position, data: { flow_rule_id: null } }
    // `Wait` solo puede llegar desde un cliente antiguo; crear cualquiera de
    // las dos variantes produce el bloque Pausa unificado.
    case NodeType.Wait:
    case NodeType.WaitAny:
      return { id, type: NodeType.WaitAny, position, data: { conditions: [{ id: WaitAnyConditionKind.Timer, kind: WaitAnyConditionKind.Timer, seconds: 1800 }] } }
    case NodeType.Question:
      return { id, type, position, data: { text: '', buttons: [{ id: 'btn_1', label: '' }], timeout_seconds: 1800 } }
    case NodeType.RoundRobin:
      return { id, type, position, data: { outputs: withPositionalOutputIds(['Salida 1', 'Salida 2']) } }
    case NodeType.End:
      return { id, type, position, data: { label: 'Fin', close_conversation: false } }
    default:
      return assertNever(type)
  }
}

function nodeIcon(node: AutomationFlowNode) {
  const actionType = node.type === NodeType.Action ? node.data.action?.type : undefined
  const tone = flowTone(node.type, actionType)
  const Icon = tone === 'message' ? MESSAGE_ICON : FLOW_NODE_VIEW[node.type].icon
  return <Icon className={`h-4 w-4 ${FLOW_TONES[tone].icon}`} />
}

function nodeTitle(node: AutomationFlowNode, rules: ReadonlyArray<{ id: number; name: string }> = []) {
  if (node.type !== NodeType.InvokeFlow) return flowNodeSummary(node.type, node.data)
  const flowRuleId = node.data.flow_rule_id
  const invokedFlowName = rules.find(item => item.id === flowRuleId)?.name ?? (flowRuleId ? `Flujo #${flowRuleId}` : undefined)
  return flowNodeSummary(node.type, { invokedFlowName })
}

function outputHandleLabel(node: AutomationFlowNode, handle: string): string {
  if (node.type === NodeType.RoundRobin) {
    const output = node.data.outputs.find(item => item.id === handle)
    return output ? output.label || handle : handle
  }
  if (node.type === NodeType.Question) {
    const button = node.data.buttons.find(item => item.id === handle)
    if (button) return button.label || handle
  }
  // Sin esto el panel mostraba el nombre interno de la salida ("next").
  if (node.type !== NodeType.Condition) return EDGE_LABELS[handle] ?? (handle === FlowHandle.Next ? 'Siguiente' : handle)
  if (handle === FlowHandle.No) return 'Ninguna'
  const index = conditionGroups(node.data, node.id).findIndex(group => group.id === handle)
  return index >= 0 ? `Salida ${index + 1}` : handle
}

interface VisualFlowBuilderProps {
  rule?: AutomationRule
  /** Llegada desde Catálogos: el servicio que hay que cambiar o quitar. */
  highlight?: ServiceHighlight
  /** Bloque al que abrir el flujo (p. ej. "Ver en el flujo" del historial). */
  initialBlock?: string
  onClose: () => void
}

// Referencia fija para el "sin datos": un `[]` nuevo por render invalidaría
// los memos del lienzo en cada render del constructor.
const EMPTY_RULES: AutomationRuleSummary[] = []

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLElement
    && !!target.closest('input, textarea, select, [contenteditable="true"]')
}

export function VisualFlowBuilder({ rule, highlight, initialBlock, onClose }: VisualFlowBuilderProps) {
  const createFlow = useCreateVisualFlow()
  const saveFlow = useSaveVisualFlow()
  const publishFlow = usePublishVisualFlow()
  const simulateFlow = useSimulateVisualFlow()
  const updateRule = useUpdateAutomation()
  const { data: automationRules = EMPTY_RULES } = useAutomationRuleSummaries()
  const { data: users = [] } = useUsers(true)
  const { data: tags = [] } = useTags()
  const { data: leadServices = [] } = useLeadServices()
  const { data: templates = [] } = useTemplates(true)
  const { data: mediaAssets = [] } = useMediaLibrary()
  const initialDefinition = (() => {
    const definition = rule?.flow_definition
    return isFlowDefinition(definition) && definition.nodes.length ? withDefaultConditions(definition) : null
  })()
  const initialPublishedDefinition = rule?.published_flow_definition
    ? withDefaultConditions(rule.published_flow_definition)
    : null
  const {
    value: flow,
    commit: setFlow,
    sync: syncFlow,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useFlowHistory<AutomationFlowDefinition>(() => {
    const definition = rule?.flow_definition
    return isFlowDefinition(definition) && definition.nodes.length
      ? withDefaultConditions(definition)
      : initialFlow()
  })
  // Desde Catálogos se abre en lo que nombra al servicio: las condiciones de
  // entrada o el primer bloque que lo cambia, no en el disparador.
  const initialReferences = highlight ? onlyPart(flowServiceReferences(flow, highlight.service), highlight.part) : null
  // Desde el historial: el bloque de ese paso, si todavía está en el flujo.
  const openAtBlock = initialBlock && flow.nodes.some(node => node.id === initialBlock) ? initialBlock : null
  const [editor, dispatch] = useFlowEditor(
    rule, initialDefinition, initialPublishedDefinition,
    openAtBlock ?? initialReferences?.nodeIds[0] ?? flow.nodes[0]?.id ?? null,
    initialReferences?.entryConditions ?? false,
  )
  const serviceReferences = useMemo(() => highlight ? onlyPart(flowServiceReferences(flow, highlight.service), highlight.part) : null, [flow, highlight])
  const flaggedNodeIds = useMemo(() => new Set(serviceReferences?.nodeIds ?? []), [serviceReferences])
  // Desde Catálogos la vista arranca acercada al bloque marcado; después, cada
  // "ir a" (aviso o conexiones) la vuelve a acercar.
  const [focus, setFocus] = useState(() => openAtBlock
    ? { ids: [openAtBlock], key: 1 }
    : initialReferences?.nodeIds.length ? { ids: initialReferences.nodeIds, key: 1 } : null)
  const missingBlockWarned = useRef(false)
  useEffect(() => {
    if (!initialBlock || openAtBlock || missingBlockWarned.current) return
    missingBlockWarned.current = true
    toast.info('Ese bloque ya no está en el flujo: se borró después de esa ejecución.')
  }, [initialBlock, openAtBlock])
  // Los errores del servidor pueden decir de qué bloque son (`target`): ese
  // bloque queda elegido y el lienzo lo acerca, así no hay que buscarlo a ojo.
  const failWith = useCallback((reason: unknown) => {
    const target = extractErrorTarget(reason)
    const known = target && flow.nodes.some(node => node.id === target) ? target : null
    dispatch({ type: 'fail', message: extractErrorMessage(reason), target: known })
    if (known) setFocus(current => ({ ids: [known], key: (current?.key ?? 0) + 1 }))
  }, [dispatch, flow.nodes])
  const goToNode = useCallback((nodeId: string) => {
    dispatch({ type: 'select', nodeId })
    setFocus(current => ({ ids: [nodeId], key: (current?.key ?? 0) + 1 }))
  }, [dispatch])
  const {
    ruleId, savedDefinition, savedName, publishedDefinition, name, maxPerHour, visibleToSellers,
    selectedId, showEntryConditions, error, errorTarget, notice, jsonViewTab, jsonCopied, publishedVersion,
  } = editor
  const { simulation: simulationOpen, versions: versionsOpen, jsonView: jsonViewOpen, importJson: importJsonOpen, exitConfirmation: exitConfirmationOpen } = editor.openDialogs
  const copiedNodeRef = useRef<AutomationFlowNode | null>(null)
  const { data: versions = [], isLoading: versionsLoading } = useFlowVersions(versionsOpen ? ruleId : null)
  const restoreVersion = useRestoreFlowVersion()
  const selected = flow.nodes.find(node => node.id === selectedId) ?? null
  const numbers = useMemo(() => numberFlowNodes(flow), [flow])
  // Bloques a los que no llega ningún camino desde el disparador: nunca se
  // ejecutan y no dejan publicar. Se marcan en el lienzo mientras se arma.
  const looseIds = useMemo(() => {
    const reachable = reachableFromTrigger(flow)
    return new Set(flow.nodes.filter(node => !reachable.has(node.id)).map(node => node.id))
  }, [flow])
  const searchItems = useMemo(() => flow.nodes.map(node => ({
    id: node.id, number: numbers.get(node.id), title: nodeTitle(node, automationRules), text: searchableText(node.data),
  })), [flow.nodes, numbers, automationRules])
  const connection = (edge: AutomationFlowEdge, nodeId: string): FlowConnection => {
    const node = flow.nodes.find(item => item.id === nodeId)
    const source = flow.nodes.find(item => item.id === edge.source)
    return {
      edgeId: edge.id, nodeId, number: numbers.get(nodeId),
      title: node ? nodeTitle(node, automationRules) : 'Bloque borrado',
      handle: source ? outputHandleLabel(source, edge.source_handle) : edge.source_handle,
    }
  }
  const incomingConnections = selected ? flow.edges.filter(edge => edge.target === selected.id).map(edge => connection(edge, edge.source)) : []
  const outgoingConnections = selected ? flow.edges.filter(edge => edge.source === selected.id).map(edge => connection(edge, edge.target)) : []
  const activeUsers = users.filter(user => user.is_active)
  const invokableFlows = automationRules.filter(item => (
    item.id !== ruleId
    && item.builder_mode === AutomationBuilderMode.Visual
    && item.published
  ))
  const automaticTemplates = useMemo(() => templates.filter(template => template.is_active && template.template_type === 'internal' && template.interactive_type === 'none'), [templates])
  const isBusy = createFlow.isPending || saveFlow.isPending || publishFlow.isPending
  const hasUnpublishedChanges = publishedDefinition == null || !areFlowDefinitionsEqual(flow, publishedDefinition)
  // Del listado (se refresca solo), no de la regla con la que se abrió el editor.
  const isActive = automationRules.find(item => item.id === ruleId)?.is_active ?? rule?.is_active ?? false
  const [confirmPausedPublish, setConfirmPausedPublish] = useState(false)
  // Solo lo leen los handlers: un ref, para que guardar no vuelva a renderizar el editor.
  const liveSaved = useRef({ maxPerHour: rule?.max_executions_per_hour ?? null, visible: rule?.visible_to_sellers ?? false })
  const hasUnsavedChanges = savedDefinition == null
    || name !== savedName
    || !areFlowDefinitionsEqual(flow, savedDefinition)
  // Con cambios sin guardar la app no se recarga sola para actualizarse
  // (ver app/pwaUpdateGuard.ts); el beforeunload de abajo cubre el F5 manual.
  useActivityHold('flow-editor', hasUnsavedChanges)
  const triggerNode = flow.nodes.find(
    (node): node is Extract<AutomationFlowNode, { type: typeof NodeType.Trigger }> => node.type === NodeType.Trigger
  )
  const isManualTrigger = triggerNode?.data.trigger_type === TriggerType.Manual
  const entryConditionCount = Object.values(flow.conditions).filter(value => (
    typeof value === 'boolean' ? value : value !== null && value !== undefined && value !== ''
  )).length

  const duplicateNode = useCallback((source: AutomationFlowNode) => {
    if (source.type === NodeType.Trigger) {
      dispatch({ type: 'fail', message: 'El disparador es único y no se puede copiar.' })
      return
    }
    const duplicate = {
      ...structuredClone(source),
      id: `${source.type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      position: { x: source.position.x + 40, y: source.position.y + 40 },
    } as AutomationFlowNode
    setFlow(current => ({ ...current, nodes: [...current.nodes, duplicate] }))
    dispatch({ type: 'select', nodeId: duplicate.id })
    copiedNodeRef.current = structuredClone(duplicate)
    dispatch({ type: 'clearFeedback' })
  }, [setFlow, dispatch])

  useEffect(() => {
    function handleBuilderShortcut(event: KeyboardEvent) {
      if ((!event.ctrlKey && !event.metaKey) || event.altKey || isEditableTarget(event.target)) return
      const key = event.key.toLowerCase()
      const wantsUndo = key === 'z' && !event.shiftKey
      const wantsRedo = key === 'y' || (key === 'z' && event.shiftKey)
      if (wantsUndo && canUndo) {
        event.preventDefault()
        undo()
      } else if (wantsRedo && canRedo) {
        event.preventDefault()
        redo()
      } else if (key === 'c' && selected && selected.type !== NodeType.Trigger) {
        event.preventDefault()
        copiedNodeRef.current = structuredClone(selected)
        dispatch({ type: 'notify', message: 'Bloque copiado. Pégalo con Cmd+V o Ctrl+V.' })
      } else if (key === 'v' && copiedNodeRef.current) {
        event.preventDefault()
        duplicateNode(copiedNodeRef.current)
      } else if (key === 'd' && selected && selected.type !== NodeType.Trigger) {
        event.preventDefault()
        duplicateNode(selected)
      }
    }
    window.addEventListener('keydown', handleBuilderShortcut)
    return () => window.removeEventListener('keydown', handleBuilderShortcut)
  }, [canRedo, canUndo, dispatch, duplicateNode, redo, selected, undo])

  useEffect(() => {
    if (!hasUnsavedChanges) return
    function warnBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warnBeforeUnload)
    return () => window.removeEventListener('beforeunload', warnBeforeUnload)
  }, [hasUnsavedChanges])

  function replaceNode(nextNode: AutomationFlowNode) {
    setFlow(current => ({
      ...current,
      nodes: current.nodes.map(node => node.id === nextNode.id ? nextNode : node),
    }), `node:${nextNode.id}`)
  }

  function replaceSelectedAction(nextAction: AutomationAction) {
    if (!selected || selected.type !== NodeType.Action) return
    replaceNode({ ...selected, data: { action: nextAction } })
  }

  function replaceConditionGroups(
    node: Extract<AutomationFlowNode, { type: typeof NodeType.Condition }>,
    groups: AutomationFlowConditionGroup[],
  ) {
    const validHandles = new Set<string>([FlowHandle.No, ...groups.map(group => group.id)])
    setFlow(current => ({
      ...current,
      nodes: current.nodes.map(item => item.id === node.id
        ? { ...node, data: { condition_groups: groups } }
        : item),
      edges: current.edges.filter(edge => edge.source !== node.id || validHandles.has(edge.source_handle)),
    }), `condition-groups:${node.id}`)
  }

  /** Igual que replaceNode pero además descarta cualquier conexión que
   *  apuntaba a una condición que ya no existe (ej. se destildó "hasta
   *  recibir mensaje") — si no, quedaría una arista apuntando a un handle
   *  que el lienzo ya no dibuja. */
  function replaceWaitAnyConditions(node: Extract<AutomationFlowNode, { type: typeof NodeType.WaitAny }>, conditions: WaitAnyCondition[]) {
    const validHandles = new Set<string>(conditions.map(condition => condition.id))
    setFlow(current => ({
      ...current,
      nodes: current.nodes.map(item => item.id === node.id ? { ...node, data: { conditions } } : item),
      edges: current.edges.filter(edge => edge.source !== node.id || validHandles.has(edge.source_handle)),
    }), `node:${node.id}`)
  }

  /** Mismo saneo que replaceWaitAnyConditions, para cuando se quita un botón
   *  de una Pregunta: "other"/"timeout"/"media" siempre quedan válidos. */
  function replaceQuestionButtons(node: Extract<AutomationFlowNode, { type: typeof NodeType.Question }>, buttons: QuestionButton[]) {
    const validHandles = new Set<string>([
      ...buttons.map(button => button.id),
      QuestionHandle.Other, QuestionHandle.Timeout, QuestionHandle.Media,
    ])
    setFlow(current => ({
      ...current,
      nodes: current.nodes.map(item => item.id === node.id ? { ...node, data: { ...node.data, buttons } } : item),
      edges: current.edges.filter(edge => edge.source !== node.id || validHandles.has(edge.source_handle)),
    }), `node:${node.id}`)
  }

  /** Mismo saneo que replaceQuestionButtons: al quitar una salida del reparto
   *  los ids posteriores corren un lugar, así que se descartan las conexiones
   *  cuyo handle ya no existe. */
  function replaceRoundRobinOutputs(node: Extract<AutomationFlowNode, { type: typeof NodeType.RoundRobin }>, outputs: RoundRobinOutput[]) {
    const validHandles = new Set<string>(outputs.map(output => output.id))
    setFlow(current => ({
      ...current,
      nodes: current.nodes.map(item => item.id === node.id ? { ...node, data: { outputs } } : item),
      edges: current.edges.filter(edge => edge.source !== node.id || validHandles.has(edge.source_handle)),
    }), `node:${node.id}`)
  }

  function updateEntryConditions(conditions: AutomationConditions) {
    setFlow(current => ({ ...current, conditions }), 'entry-conditions')
  }

  const addNode = useCallback((type: AutomationFlowNodeType, position: { x: number; y: number }, from?: { source: string; handle: string }) => {
    if (type === NodeType.Trigger) {
      dispatch({ type: 'fail', message: 'El flujo solo puede tener un disparador.' })
      return null
    }
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    // Con `from` (se soltó una conexión en el vacío) el bloque nace conectado,
    // en el mismo cambio: un solo Ctrl+Z deshace bloque y conexión. Como al
    // conectar a mano, esa salida deja de apuntar a donde apuntaba.
    const edge: AutomationFlowEdge | null = from
      ? { id: `edge-${from.source}-${from.handle}-${id}`, source: from.source, target: id, source_handle: from.handle }
      : null
    setFlow(current => ({
      ...current,
      nodes: [...current.nodes, createFlowNode(type, id, position.x, position.y)],
      edges: edge
        ? [...current.edges.filter(item => !(item.source === edge.source && item.source_handle === edge.source_handle)), edge]
        : current.edges,
    }))
    dispatch({ type: 'select', nodeId: id })
    dispatch({ type: 'clearFeedback' })
    return id
  }, [setFlow, dispatch])

  // Clic en la barra lateral: el bloque va después del elegido y, si su única
  // salida está libre, nace conectado (domain/flowPlacement). La vista va a él.
  function addFromPalette(type: AutomationFlowNodeType) {
    const placement = placeNewNode(flow.nodes, flow.edges, selectedId)
    const id = addNode(type, placement.position, placement.from)
    if (id) goToNode(id)
  }

  // La comprobación del disparador se hace antes de actualizar, leyendo `flow`
  // de las dependencias. Antes vivía dentro del updater de setFlow, que debe
  // ser puro: React puede ejecutarlo más de una vez, y el setError anidado
  // podía repetirse o disparar sobre un estado que nunca llegó a confirmarse.
  const removeNodes = useCallback((nodeIds: string[]) => {
    const requested = new Set(nodeIds)
    const removable = new Set(
      flow.nodes
        .filter(node => requested.has(node.id) && node.type !== NodeType.Trigger)
        .map(node => node.id),
    )
    if (removable.size === 0) {
      if (flow.nodes.some(node => requested.has(node.id) && node.type === NodeType.Trigger)) {
        dispatch({ type: 'fail', message: 'El disparador no se puede borrar, pero puedes cambiar su evento en el panel derecho.' })
      }
      return
    }
    if (flow.nodes.some(node => requested.has(node.id) && node.type === NodeType.Trigger)) {
      dispatch({ type: 'fail', message: 'Se borraron los bloques elegidos, menos el disparador, que no se puede borrar.' })
    } else {
      dispatch({ type: 'clearFeedback' })
    }
    setFlow(current => ({
      ...current,
      nodes: current.nodes.filter(item => !removable.has(item.id)),
      edges: current.edges.filter(edge => !removable.has(edge.source) && !removable.has(edge.target)),
    }))
    dispatch({ type: 'deselectRemoved', removedIds: removable })
  }, [flow, setFlow, dispatch])

  const moveNodes = useCallback((moves: Array<{ id: string; position: { x: number; y: number } }>) => {
    const positions = new Map(moves.map(move => [move.id, move.position]))
    setFlow(current => ({
      ...current,
      nodes: current.nodes.map(node => {
        const position = positions.get(node.id)
        return position ? { ...node, position } : node
      }),
    }))
  }, [setFlow])

  const connectNodes = useCallback((edge: AutomationFlowEdge) => {
    dispatch({ type: 'clearFeedback' })
    setFlow(current => ({
      ...current,
      // Una salida solo puede apuntar a un destino: reconectar reemplaza la
      // conexión anterior de ese mismo handle en vez de sumar una segunda.
      edges: [
        ...current.edges.filter(
          item => !(item.source === edge.source && item.source_handle === edge.source_handle),
        ),
        edge,
      ],
    }))
  }, [setFlow, dispatch])

  const removeEdge = useCallback((edgeId: string) => {
    setFlow(current => ({ ...current, edges: current.edges.filter(edge => edge.id !== edgeId) }))
  }, [setFlow])

  function autoLayout() {
    const trigger = flow.nodes.find(node => node.type === NodeType.Trigger)
    if (!trigger) return
    const levels = new Map<string, number>([[trigger.id, 0]])
    const queue = [trigger.id]
    while (queue.length) {
      const source = queue.shift()!
      const level = levels.get(source) ?? 0
      flow.edges.filter(edge => edge.source === source).forEach(edge => {
        if (!levels.has(edge.target)) { levels.set(edge.target, level + 1); queue.push(edge.target) }
      })
    }
    const groups = new Map<number, string[]>()
    flow.nodes.forEach(node => {
      const level = levels.get(node.id) ?? Math.max(1, levels.size)
      groups.set(level, [...(groups.get(level) ?? []), node.id])
    })
    setFlow(current => ({
      ...current,
      nodes: current.nodes.map(node => {
        const level = levels.get(node.id) ?? Math.max(1, levels.size)
        const group = groups.get(level) ?? [node.id]
        const row = group.indexOf(node.id)
        return { ...node, position: { x: 60 + level * 370, y: 100 + row * 260 } }
      }),
    }))
  }

  function applySavedFlow(saved: AutomationRule) {
    let definition: AutomationFlowDefinition | null = null
    if (isFlowDefinition(saved.flow_definition)) {
      definition = withDefaultConditions(saved.flow_definition)
      syncFlow(definition)
    }
    dispatch({ type: 'draftSaved', ruleId: saved.id, name: saved.name, definition })
  }

  async function persistDraft() {
    dispatch({ type: 'clearFeedback' })
    try {
      const saved = ruleId == null
        ? await createFlow.mutateAsync({ name, flow_definition: flow })
        : await saveFlow.mutateAsync({ id: ruleId, name, flow_definition: flow })
      applySavedFlow(saved)
      return saved
    } catch (reason) {
      failWith(reason)
      return null
    }
  }

  async function importFlowJson(flowDefinition: AutomationFlowDefinition) {
    dispatch({ type: 'clearFeedback' })
    const saved = ruleId == null
      ? await createFlow.mutateAsync({ name, flow_definition: flowDefinition })
      : await saveFlow.mutateAsync({ id: ruleId, name, flow_definition: flowDefinition })
    applySavedFlow(saved)
    dispatch({ type: 'select', nodeId: null })
    toast.success('Flujo reemplazado desde JSON.')
  }

  // Máximo por hora y "Visible para vendedores" se guardan al instante (no van por
  // borrador). Se comparan con lo último guardado, no con la regla con la que
  // se abrió el editor: con esa, volver al valor original no se guardaba.
  function commitMaxPerHour(value: number | null) {
    dispatch({ type: 'maxPerHourChanged', value })
    if (ruleId == null || value === liveSaved.current.maxPerHour) return
    updateRule.mutate({ id: ruleId, max_executions_per_hour: value }, {
      onSuccess: () => { liveSaved.current.maxPerHour = value },
      onError: reason => failWith(reason),
    })
  }

  function commitVisibleToSellers(value: boolean) {
    dispatch({ type: 'visibleToSellersChanged', value })
    if (ruleId == null || value === liveSaved.current.visible) return
    updateRule.mutate({ id: ruleId, visible_to_sellers: value }, {
      onSuccess: () => { liveSaved.current.visible = value },
      onError: reason => failWith(reason),
    })
  }

  async function restore(version: number) {
    if (ruleId == null) return
    dispatch({ type: 'clearFeedback' })
    try {
      const restored = await restoreVersion.mutateAsync({ id: ruleId, version })
      if (isFlowDefinition(restored.flow_definition)) setFlow(withDefaultConditions(restored.flow_definition))
      dispatch({ type: 'rename', name: restored.name })
      dispatch({ type: 'closeDialog', dialog: 'versions' })
      dispatch({ type: 'versionRestored', version })
    } catch (reason) { failWith(reason) }
  }

  // Publicar activa el flujo. Si ya se había publicado y alguien lo pausó,
  // primero se pregunta: antes se reactivaba sin avisar.
  function requestPublish() {
    if (publishedVersion && !isActive) setConfirmPausedPublish(true)
    else void publish(true)
  }

  /** `fromPausedDialog`: se publica desde la pregunta de flujo pausado, y el
   *  aviso tiene que confirmar lo que se eligió. */
  async function publish(resume: boolean, fromPausedDialog = false) {
    setConfirmPausedPublish(false)
    const saved = await persistDraft()
    if (!saved) return
    try {
      const published = await publishFlow.mutateAsync(saved.id)
      if (!resume) await updateRule.mutateAsync({ id: saved.id, is_active: false })
      // Publicar guarda como borrador la versión validada, que completa campos
      // por defecto (`minutes`, `close_conversation`). Sin tomarla, el lienzo
      // seguía distinto de lo publicado: "Cambios sin publicar" y el botón
      // habilitado justo después de publicar.
      applySavedFlow(published)
      dispatch({
        type: 'published',
        definition: published.published_flow_definition
          ? withDefaultConditions(published.published_flow_definition)
          : null,
        version: published.flow_version,
        pausedChoice: fromPausedDialog ? (resume ? 'resume' : 'keepPaused') : undefined,
      })
    } catch (reason) { failWith(reason) }
  }

  async function simulate(leadId: string) {
    const saved = await persistDraft()
    if (!saved) return null
    try {
      return await simulateFlow.mutateAsync({ id: saved.id, leadId })
    } catch (reason) {
      // El error se ve en la franja del editor (y, si es de un bloque, el
      // lienzo va a él): la ventana de la prueba lo tapaba.
      dispatch({ type: 'closeDialog', dialog: 'simulation' })
      failWith(reason)
      return null
    }
  }

  function requestClose() {
    if (hasUnsavedChanges) dispatch({ type: 'openDialog', dialog: 'exitConfirmation' })
    else onClose()
  }

  async function saveAndClose() {
    const saved = await persistDraft()
    if (saved) onClose()
  }

  return <div data-flow-builder className="fixed inset-0 z-[60] flex flex-col bg-wa-field dark:bg-flow-canvas-dark">
    <header className="flex flex-wrap items-center gap-3 border-b border-wa-border bg-white px-4 py-3 dark:border-flow-border-dark dark:bg-flow-panel-dark">
      <button type="button" onClick={requestClose} aria-label="Cerrar el editor" className="rounded-lg p-2 text-wa-muted hover:bg-wa-field dark:hover:bg-white/10"><X className="h-5 w-5" /></button>
      <div className="min-w-[220px] flex-1"><input value={name} maxLength={120} onChange={event => dispatch({ type: 'rename', name: event.target.value })} className="w-full max-w-md border-0 bg-transparent text-base font-semibold text-wa-text outline-none dark:text-white" /><p className="mt-0.5 flex flex-wrap items-center gap-2 text-[11px] text-wa-muted dark:text-wa-muted-dark">{ruleId ? `Flujo #${ruleId}` : 'Flujo nuevo'}<FlowStatusPill publishedVersion={publishedVersion} hasUnpublishedChanges={hasUnpublishedChanges} isActive={isActive} /></p></div>
      <div className="flex items-center overflow-hidden rounded-lg border border-wa-border dark:border-white/10 dark:bg-white/5" role="group" aria-label="Deshacer y rehacer">
        <button type="button" disabled={!canUndo} onClick={undo} title="Deshacer (Cmd+Z o Ctrl+Z)" aria-label="Deshacer" className="border-r border-wa-border p-2 text-gray-600 hover:bg-wa-field disabled:cursor-not-allowed disabled:opacity-30 dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10"><Undo2 className="h-4 w-4" /></button>
        <button type="button" disabled={!canRedo} onClick={redo} title="Rehacer (Cmd+Shift+Z o Ctrl+Y)" aria-label="Rehacer" className="p-2 text-gray-600 hover:bg-wa-field disabled:cursor-not-allowed disabled:opacity-30 dark:text-gray-300 dark:hover:bg-white/10"><Redo2 className="h-4 w-4" /></button>
      </div>
      <button type="button" onClick={() => dispatch({ type: 'toggleEntryConditions' })} className={`flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold ${showEntryConditions ? 'border-wa-primary/40 bg-wa-primary/10 text-wa-primary-strong dark:border-emerald-700/50 dark:bg-emerald-950/20 dark:text-emerald-300' : 'border-wa-border text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300'}`}><ListFilter className="h-4 w-4" />Condiciones de entrada{entryConditionCount > 0 && <span className="rounded-full bg-wa-primary px-1.5 py-0.5 text-[9px] text-white">{entryConditionCount}</span>}</button>
      <label title={ruleId == null ? 'Guarda el borrador primero' : 'Cuántos leads pueden entrar al flujo por hora. Los que pasen el límite entran más tarde. Vacío = sin límite.'} className="flex items-center gap-1.5 rounded-lg border border-wa-border px-3 py-2 text-xs font-semibold text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">Máximo por hora<input type="number" min={1} max={1000} disabled={ruleId == null} placeholder="∞" value={maxPerHour ?? ''} onChange={event => dispatch({ type: 'maxPerHourChanged', value: event.target.value ? Number(event.target.value) : null })} onBlur={event => commitMaxPerHour(event.target.value ? Number(event.target.value) : null)} className="w-16 rounded border border-wa-border bg-white px-1.5 py-1 text-xs disabled:opacity-40 dark:border-white/10 dark:bg-white/10 dark:text-white" /></label>
      {isManualTrigger && !visibleToSellers && ruleId != null && triggerNode && (
        // El ajuste vive en el disparador; acá solo se avisa, porque oculto
        // los vendedores no lo encuentran en el chat.
        <button type="button" onClick={() => goToNode(triggerNode.id)} title="Ver el ajuste en el disparador" className="flex items-center gap-1.5 rounded-lg border border-wa-border px-3 py-2 text-xs font-semibold text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300">
          <EyeOff className="h-4 w-4" aria-hidden="true" />Oculto para vendedores
        </button>
      )}
      <button type="button" onClick={autoLayout} title="Acomoda los bloques en columnas según la ruta" className="flex items-center gap-1.5 rounded-lg border border-wa-border px-3 py-2 text-xs font-semibold text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"><LayoutGrid className="h-4 w-4" />Ordenar</button>
      <button type="button" disabled={ruleId == null} title={ruleId == null ? 'Guarda el borrador primero' : 'Ver versiones publicadas'} onClick={() => dispatch({ type: 'openDialog', dialog: 'versions' })} className="flex items-center gap-1.5 rounded-lg border border-wa-border px-3 py-2 text-xs font-semibold text-gray-600 disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"><History className="h-4 w-4" />Versiones</button>
      <button type="button" onClick={() => dispatch({ type: 'openDialog', dialog: 'simulation' })} title="Mira qué ruta seguiría un lead, sin enviarle nada" className="flex items-center gap-1.5 rounded-lg border border-wa-border px-3 py-2 text-xs font-semibold text-gray-600 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"><Beaker className="h-4 w-4" />Probar</button>
      <div className="flex items-center overflow-hidden rounded-lg border border-wa-border dark:border-white/10 dark:bg-white/5" role="group" aria-label="JSON del flujo">
        <button type="button" title="Ver el flujo en formato JSON (avanzado)" onClick={() => dispatch({ type: 'openDialog', dialog: 'jsonView' })} className="border-r border-wa-border p-2 text-gray-600 hover:bg-wa-field dark:border-white/10 dark:text-gray-300 dark:hover:bg-white/10"><Braces className="h-4 w-4" /></button>
        <button type="button" title="Importar un JSON y reemplazar todo el flujo (avanzado)" onClick={() => dispatch({ type: 'openDialog', dialog: 'importJson' })} className="p-2 text-gray-600 hover:bg-wa-field dark:text-gray-300 dark:hover:bg-white/10"><Upload className="h-4 w-4" /></button>
      </div>
      <button type="button" disabled={isBusy} onClick={() => void persistDraft()} className="flex items-center gap-1.5 rounded-lg border border-wa-border px-3 py-2 text-xs font-semibold text-gray-600 disabled:opacity-40 dark:border-white/10 dark:bg-white/5 dark:text-gray-300"><Save className="h-4 w-4" />Guardar borrador</button>
      <button type="button" disabled={isBusy || !hasUnpublishedChanges} title={!hasUnpublishedChanges ? 'No hay cambios para publicar' : 'Publicar: los leads que entren desde ahora usarán esta versión'} onClick={requestPublish} className="flex items-center gap-1.5 rounded-lg bg-wa-primary px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Publicar</button>
    </header>

    {highlight && serviceReferences && <div className="border-b border-wa-border px-4 py-2 dark:border-flow-border-dark"><ServiceHighlightNotice highlight={highlight} where={flowServiceSummary(serviceReferences)} doneHint="Publica el flujo (la versión publicada todavía lo usa)">
      {serviceReferences.nodeIds.map(nodeId => <button key={nodeId} type="button" onClick={() => goToNode(nodeId)} className="rounded-md border border-amber-300 bg-white/70 px-2 py-0.5 font-semibold hover:bg-white dark:border-amber-800 dark:bg-amber-950/60">Ver bloque #{numbers.get(nodeId)}</button>)}
    </ServiceHighlightNotice></div>}
    {(error || notice) && <FeedbackBar error={error} notice={notice} blockNumber={errorTarget ? numbers.get(errorTarget) : undefined} onGoToBlock={errorTarget ? () => goToNode(errorTarget) : undefined} />}

    <div className="flex min-h-0 flex-1">
      <aside className="w-48 shrink-0 overflow-y-auto border-r border-wa-border bg-white p-3 dark:border-flow-border-dark dark:bg-flow-panel-dark">
        <p className="text-[10px] font-bold uppercase tracking-wider text-wa-muted dark:text-wa-muted-dark">Agregar bloque</p><p className="mb-2 mt-0.5 text-[10px] text-wa-muted dark:text-wa-muted-dark">Clic: va después del bloque elegido. También puedes arrastrarlo.</p>
        {FLOW_PALETTE.map(({ type, label, icon: Icon, description }) => <button type="button" key={type} draggable onDragStart={event => event.dataTransfer.setData('application/x-flow-palette', type)} onClick={() => addFromPalette(type)} className="group mb-2 block w-full cursor-grab rounded-xl border border-wa-border bg-wa-hover p-3 text-left hover:border-wa-primary/40 focus-visible:outline-2 focus-visible:outline-wa-primary active:cursor-grabbing dark:border-transparent dark:bg-transparent dark:hover:bg-white/5 dark:transition-colors"><div className="flex items-center gap-2 text-xs font-semibold text-gray-800 dark:text-wa-text-dark"><Icon className={`h-4 w-4 ${FLOW_TONES[flowTone(type)].icon}`} />{label}</div><p className="mt-1 text-[10px] text-wa-muted dark:text-wa-muted-dark">{description}</p></button>)}
      </aside>

      <main className="relative min-w-0 flex-1 bg-wa-field dark:bg-flow-canvas-dark">
        <FlowNodeSearch items={searchItems} onGo={goToNode} />
        <FlowCanvas
          flow={flow}
          templates={automaticTemplates}
          mediaAssets={mediaAssets}
          flowRules={automationRules}
          tags={tags}
          users={users}
          selectedId={selectedId}
          flaggedIds={flaggedNodeIds}
          numbers={numbers}
          looseIds={looseIds}
          focus={focus}
          onSelect={id => dispatch({ type: 'select', nodeId: id })}
          onMoveNodes={moveNodes}
          onDeleteNodes={removeNodes}
          onConnect={connectNodes}
          onDeleteEdge={removeEdge}
          onDropNewNode={addNode}
        />
      </main>

      {(showEntryConditions || selected) && <aside className="w-80 shrink-0 overflow-y-auto border-l border-wa-border bg-white p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark">
        {showEntryConditions ? <EntryConditionsEditor conditions={flow.conditions} updateConditions={updateEntryConditions} users={activeUsers} tags={tags} highlightService={highlight?.part === 'condition' ? highlight.service : undefined} /> : selected && <><div className="mb-4 flex items-start gap-2">{nodeIcon(selected)}<div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold text-wa-text dark:text-white">{nodeTitle(selected, automationRules)}</p><p className="text-[10px] text-wa-muted">Bloque #{numbers.get(selected.id)} · propiedades</p></div><button type="button" onClick={() => goToNode(selected.id)} title="Acercar la vista a este bloque" className="flex shrink-0 items-center gap-1 rounded-lg border border-wa-border px-2 py-1.5 text-[10px] font-semibold text-gray-600 hover:bg-wa-hover dark:border-wa-border-dark dark:text-gray-300 dark:hover:bg-wa-head-dark"><LocateFixed className="h-3.5 w-3.5" aria-hidden="true" />Ver</button>{selected.type !== NodeType.Trigger && <button type="button" onClick={() => duplicateNode(selected)} title="Duplicar bloque (Cmd+D o Ctrl+D)" aria-label="Duplicar bloque" className="flex shrink-0 items-center gap-1 rounded-lg border border-wa-border px-2 py-1.5 text-[10px] font-semibold text-gray-600 hover:bg-wa-hover dark:border-wa-border-dark dark:text-gray-300 dark:hover:bg-wa-head-dark"><Copy className="h-3.5 w-3.5" />Duplicar</button>}</div>
          {selected.type === NodeType.Trigger && <div className="space-y-3"><label className="grid gap-1 text-[10px] text-wa-muted">Evento<Select value={selected.data.trigger_type} onChange={event => { const value = event.target.value; if (isAutomationTrigger(value)) replaceNode({ ...selected, data: { ...selected.data, trigger_type: value } }) }} className={fieldClass}>{TRIGGERS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></label>{RESPONSE_OVERDUE_TRIGGERS.has(selected.data.trigger_type) && <label className="grid gap-1 text-[10px] text-wa-muted">Minutos sin respuesta<input type="number" min={1} max={43200} value={selected.data.minutes ?? 30} onChange={event => replaceNode({ ...selected, data: { ...selected.data, minutes: Number(event.target.value) } })} className={fieldClass} /></label>}{selected.data.trigger_type === TriggerType.Manual && <SellerVisibilityField visible={visibleToSellers} saved={ruleId != null} onChange={commitVisibleToSellers} />}</div>}
          {selected.type === NodeType.Condition && <ConditionGroupsEditor groups={conditionGroups(selected.data, selected.id)} users={activeUsers} tags={tags} onChange={groups => replaceConditionGroups(selected, groups)} />}
          {selected.type === NodeType.WaitAny && <WaitAnyEditor conditions={selected.data.conditions} onChange={conditions => replaceWaitAnyConditions(selected, conditions)} />}
          {selected.type === NodeType.Question && <QuestionEditor
            text={selected.data.text}
            buttons={selected.data.buttons}
            timeoutSeconds={selected.data.timeout_seconds}
            updateText={text => replaceNode({ ...selected, data: { ...selected.data, text } })}
            updateTimeout={timeout_seconds => replaceNode({ ...selected, data: { ...selected.data, timeout_seconds } })}
            updateButtons={buttons => replaceQuestionButtons(selected, buttons)}
          />}
          {selected.type === NodeType.RoundRobin && <RoundRobinEditor
            outputs={selected.data.outputs}
            updateOutputs={outputs => replaceRoundRobinOutputs(selected, outputs)}
          />}
          {selected.type === NodeType.InvokeFlow && <div className="space-y-3"><label className="grid gap-1 text-[10px] text-wa-muted">Flujo que se inicia<Select value={selected.data.flow_rule_id ?? ''} onChange={event => replaceNode({ ...selected, data: { flow_rule_id: Number(event.target.value) || null } })} className={fieldClass}><option value="">Selecciona un flujo publicado</option>{invokableFlows.map(item => <option key={item.id} value={item.id}>{item.name}{item.is_active ? '' : ' (pausado)'}</option>)}</Select></label><p className="rounded-lg bg-indigo-50 p-2 text-[10px] leading-relaxed text-indigo-700 dark:bg-indigo-950/30 dark:text-indigo-300">El otro flujo empieza para el mismo lead. Este no lo espera: sigue de inmediato por su salida, que normalmente conectas a un Fin.</p>{invokableFlows.length === 0 && <p className="text-[10px] text-amber-600">Para usar este bloque, primero publica otro flujo visual.</p>}</div>}
          {selected.type === NodeType.End && <div className="space-y-3"><label className="grid gap-1 text-[10px] text-wa-muted">Nombre de este final<input maxLength={80} value={selected.data.label} onChange={event => replaceNode({ ...selected, data: { ...selected.data, label: event.target.value } })} className={fieldClass} /></label><label className="flex items-start gap-2 rounded-xl border border-wa-border bg-wa-hover p-3 text-[10px] text-gray-700 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-gray-200"><Checkbox checked={selected.data.close_conversation === true} onChange={event => replaceNode({ ...selected, data: { ...selected.data, close_conversation: event.target.checked } })} /><span><strong className="block text-xs">Cerrar conversación al finalizar</strong><span className="mt-0.5 block text-wa-muted">Marca el chat como cerrado cuando un lead llega a este Fin.</span></span></label></div>}
          {selected.type === NodeType.Action && <ActionEditor action={selected.data.action} updateAction={replaceSelectedAction} users={activeUsers} tags={tags} leadServices={leadServices} templates={automaticTemplates} mediaAssets={mediaAssets} highlightService={highlight?.part === 'action' ? highlight.service : undefined} />}
          <FlowNodeConnections incoming={incomingConnections} outgoing={outgoingConnections} onGo={goToNode} onRemove={removeEdge} />
        </>}
      </aside>}
    </div>

    <PublishPausedDialog open={confirmPausedPublish} onResume={() => void publish(true, true)} onKeepPaused={() => void publish(false, true)} onCancel={() => setConfirmPausedPublish(false)} />
    {simulationOpen && <FlowSimulationDialog isSimulating={simulateFlow.isPending} onSimulate={simulate} onClose={() => dispatch({ type: 'closeDialog', dialog: 'simulation' })} numbers={numbers} onGoToNode={nodeId => { dispatch({ type: 'closeDialog', dialog: 'simulation' }); goToNode(nodeId) }} />}
    {versionsOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onMouseDown={event => { if (event.target === event.currentTarget) dispatch({ type: 'closeDialog', dialog: 'versions' }) }}>
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-2xl dark:bg-wa-panel-dark">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-wa-text dark:text-white"><History className="h-4 w-4 text-wa-primary-strong" />Versiones publicadas</h2>
            <p className="mt-1 text-[11px] text-wa-muted">Restaurar copia esa versión en el borrador. Los leads siguen con la versión publicada hasta que publiques.</p>
          </div>
          <button type="button" onClick={() => dispatch({ type: 'closeDialog', dialog: 'versions' })} className="text-wa-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-4 space-y-2">
          {versionsLoading ? <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-wa-muted" /></div>
            : versions.length === 0 ? <p className="py-8 text-center text-xs text-wa-muted">Este flujo todavía no se publicó ninguna vez.</p>
            : versions.map(item => (
              <div key={item.version} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${item.is_current ? 'border-wa-primary/40 bg-green-50 dark:border-green-800 dark:bg-green-950/30' : 'border-wa-border dark:border-wa-border-dark'}`}>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-wa-text dark:text-white">Versión {item.version}{item.is_current && <span className="ml-2 rounded-full bg-wa-primary px-1.5 py-0.5 text-[9px] font-bold text-white">En uso</span>}</p>
                  <p className="text-[10px] text-wa-muted">{item.node_count} bloques · {item.edge_count} conexiones · {new Date(item.created_at).toLocaleString('es-PE', { dateStyle: 'short', timeStyle: 'short' })}</p>
                </div>
                <button type="button" disabled={restoreVersion.isPending} onClick={() => void restore(item.version)} className="shrink-0 rounded-lg border border-wa-border px-2.5 py-1.5 text-[11px] font-semibold text-gray-600 hover:bg-wa-hover disabled:opacity-40 dark:border-wa-border-dark dark:text-gray-300 dark:hover:bg-wa-head-dark">Restaurar</button>
              </div>
            ))}
        </div>
      </div>
    </div>}
    {jsonViewOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <button type="button" aria-label="Cerrar" onClick={() => dispatch({ type: 'closeDialog', dialog: 'jsonView' })} className="absolute inset-0 cursor-default" />
      <div className="relative z-10 flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-wa-panel-dark">
        <div className="flex items-start justify-between p-5 pb-0">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold text-wa-text dark:text-white"><Braces className="h-4 w-4 text-wa-primary-strong" />JSON del flujo</h2>
            <p className="mt-1 text-[11px] text-wa-muted">Los bloques y conexiones del flujo, tal como se guardan.</p>
          </div>
          <button type="button" aria-label="Cerrar" onClick={() => dispatch({ type: 'closeDialog', dialog: 'jsonView' })} className="text-wa-muted"><X className="h-5 w-5" /></button>
        </div>
        <div className="mt-3 flex items-center gap-2 px-5">
          <button type="button" onClick={() => dispatch({ type: 'jsonTabChanged', tab: 'draft' })} className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${jsonViewTab === 'draft' ? 'bg-wa-primary text-white' : 'border border-wa-border text-gray-600 dark:border-wa-border-dark dark:text-gray-300'}`}>Borrador actual</button>
          <button type="button" disabled={!publishedDefinition} title={!publishedDefinition ? 'Este flujo aún no se publicó' : undefined} onClick={() => dispatch({ type: 'jsonTabChanged', tab: 'published' })} className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-40 ${jsonViewTab === 'published' ? 'bg-wa-primary text-white' : 'border border-wa-border text-gray-600 dark:border-wa-border-dark dark:text-gray-300'}`}>Publicado{rule?.flow_version ? ` (v${rule.flow_version})` : ''}</button>
          <button
            type="button"
            onClick={() => {
              const text = JSON.stringify(jsonViewTab === 'published' ? (publishedDefinition ?? flow) : flow, null, 2)
              void navigator.clipboard.writeText(text)
              dispatch({ type: 'jsonCopied', copied: true })
              window.setTimeout(() => dispatch({ type: 'jsonCopied', copied: false }), 1500)
            }}
            className="ml-auto flex items-center gap-1.5 rounded-lg border border-wa-border px-3 py-1.5 text-xs font-semibold text-gray-600 hover:bg-wa-hover dark:border-wa-border-dark dark:text-gray-300 dark:hover:bg-wa-head-dark"
          ><Copy className="h-3.5 w-3.5" />{jsonCopied ? 'Copiado' : 'Copiar'}</button>
        </div>
        <pre className="m-5 mt-3 min-h-0 flex-1 overflow-auto rounded-xl bg-wa-hover p-3 text-[11px] leading-relaxed text-gray-800 dark:bg-wa-head-dark dark:text-gray-200"><code>{JSON.stringify(jsonViewTab === 'published' ? (publishedDefinition ?? flow) : flow, null, 2)}</code></pre>
      </div>
    </div>}
    {importJsonOpen && <ImportFlowJsonDialog
      title="Reemplazar flujo con JSON"
      description="Pega el JSON de un flujo o sube un archivo .json. Se guarda de inmediato como el borrador de este flujo."
      confirmLabel="Reemplazar flujo"
      destructiveNotice="Esto reemplaza todos los bloques y conexiones del flujo por los del JSON. La versión publicada no cambia hasta que publiques."
      onClose={() => dispatch({ type: 'closeDialog', dialog: 'importJson' })}
      onImport={importFlowJson}
    />}
    {exitConfirmationOpen && <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4" onMouseDown={event => { if (event.target === event.currentTarget) dispatch({ type: 'closeDialog', dialog: 'exitConfirmation' }) }}>
      <div role="alertdialog" aria-modal="true" aria-labelledby="unsaved-flow-title" className="w-full max-w-md rounded-2xl bg-white p-5 shadow-2xl dark:bg-wa-panel-dark">
        <h2 id="unsaved-flow-title" className="text-sm font-semibold text-wa-text dark:text-white">Hay cambios sin guardar</h2>
        <p className="mt-2 text-xs leading-relaxed text-wa-muted">Guarda el borrador antes de salir para conservar la configuración actual. Guardarlo no modifica la versión publicada.</p>
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={isBusy} onClick={() => dispatch({ type: 'closeDialog', dialog: 'exitConfirmation' })} className="rounded-lg px-3 py-2 text-xs font-semibold text-gray-600 hover:bg-wa-hover disabled:opacity-40 dark:text-gray-300 dark:hover:bg-wa-head-dark">Seguir editando</button>
          <button type="button" disabled={isBusy} onClick={onClose} className="rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-40 dark:border-red-900 dark:text-red-300 dark:hover:bg-red-950/30">Salir sin guardar</button>
          <button type="button" disabled={isBusy} onClick={() => void saveAndClose()} className="flex items-center gap-1.5 rounded-lg bg-wa-primary px-3 py-2 text-xs font-semibold text-white disabled:opacity-40">{isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}Guardar borrador y salir</button>
        </div>
      </div>
    </div>}
  </div>
}

interface ConditionGroupsEditorProps {
  groups: AutomationFlowConditionGroup[]
  users: AppUser[]
  tags: Tag[]
  onChange: (groups: AutomationFlowConditionGroup[]) => void
}

function ConditionGroupsEditor({ groups, users, tags, onChange }: ConditionGroupsEditorProps) {
  const stageCatalog = useLeadStageCatalog()
  const totalConditions = groups.reduce((sum, group) => sum + group.conditions.length, 0)

  function updateCondition(groupId: string, conditionId: string, patch: Partial<AutomationFlowConditionItem>) {
    onChange(groups.map(group => group.id !== groupId ? group : {
      ...group,
      conditions: group.conditions.map(condition => condition.id === conditionId
        ? { ...condition, ...patch }
        : condition),
    }))
  }

  function changeConditionType(groupId: string, conditionId: string, type: AutomationFlowConditionType) {
    updateCondition(groupId, conditionId, { condition_type: type, value: defaultConditionValue(type) })
  }

  function addAnd(groupId: string) {
    if (totalConditions >= 30) return
    onChange(groups.map(group => group.id === groupId && group.conditions.length < 10
      ? { ...group, conditions: [...group.conditions, newConditionItem()] }
      : group))
  }

  function addOrGroup() {
    if (groups.length >= 10 || totalConditions >= 30) return
    onChange([...groups, {
      id: `group-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      conditions: [newConditionItem()],
    }])
  }

  function removeCondition(groupId: string, conditionId: string) {
    const next = groups.reduce<AutomationFlowConditionGroup[]>((remaining, group) => {
      const updated = group.id === groupId
        ? { ...group, conditions: group.conditions.filter(condition => condition.id !== conditionId) }
        : group
      if (updated.conditions.length > 0) remaining.push(updated)
      return remaining
    }, [])
    if (next.length) onChange(next)
  }

  return <div className="space-y-3">
    <p className="rounded-lg bg-blue-50 p-2 text-[10px] leading-relaxed text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">En cada salida deben cumplirse todas sus condiciones (<strong>Y</strong>). Las salidas se revisan en orden (<strong>O</strong>) y el lead sale por la primera que se cumpla.</p>
    {groups.map((group, groupIndex) => <div key={group.id}>
      {groupIndex > 0 && <div className="my-2 flex items-center gap-2 text-[9px] font-bold uppercase text-amber-600"><span className="h-px flex-1 bg-amber-200 dark:bg-amber-900" />O<span className="h-px flex-1 bg-amber-200 dark:bg-amber-900" /></div>}
      <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50/50 p-2.5 dark:border-amber-900 dark:bg-amber-950/20">
        <p className="text-[9px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">Salida {groupIndex + 1}</p>
        {group.conditions.map((condition, conditionIndex) => <div key={condition.id} className="rounded-lg border border-wa-border bg-white p-2 dark:border-wa-border-dark dark:bg-wa-head-dark">
          {conditionIndex > 0 && <p className="mb-1 text-center text-[9px] font-bold uppercase text-wa-primary-strong">Y</p>}
          <div className="flex items-start gap-1.5">
            <div className="min-w-0 flex-1 space-y-2">
              <Select value={condition.condition_type} onChange={event => { const value = event.target.value; if (isFlowConditionType(value)) changeConditionType(group.id, condition.id, value) }} className={fieldClass}>{Object.entries(CONDITION_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
              {condition.condition_type === ConditionType.StageEquals && <Select value={String(condition.value ?? INITIAL_LEAD_STAGE)} onChange={event => updateCondition(group.id, condition.id, { value: event.target.value })} className={fieldClass}>{conditionStageOptions(stageCatalog, String(condition.value ?? INITIAL_LEAD_STAGE)).map(stage => <option key={stage.key} value={stage.key}>{stage.is_active ? stage.name : `${stage.name} (inactiva)`}</option>)}</Select>}
              {condition.condition_type === ConditionType.OriginContains && <label className="grid gap-1 text-[10px] text-wa-muted">Origen a buscar<input maxLength={120} value={String(condition.value ?? '')} onChange={event => updateCondition(group.id, condition.id, { value: event.target.value })} placeholder="Ej. Facebook" className={fieldClass} /></label>}
              {condition.condition_type === ConditionType.ServiceContains && <label className="grid gap-1 text-[10px] text-wa-muted">Servicio a buscar<input maxLength={120} value={String(condition.value ?? '')} onChange={event => updateCondition(group.id, condition.id, { value: event.target.value })} placeholder="Ej. Limpieza" className={fieldClass} /></label>}
              {MESSAGE_CONDITION_TYPES.has(condition.condition_type) && <label className="grid gap-1 text-[10px] text-wa-muted">{condition.condition_type === ConditionType.MediaAnalysisContains ? 'Texto en la descripción del archivo' : 'Contenido del mensaje'}<input maxLength={500} value={String(condition.value ?? '')} onChange={event => updateCondition(group.id, condition.id, { value: event.target.value })} placeholder={condition.condition_type === ConditionType.MediaAnalysisContains ? 'Ej. comprobante de pago' : 'Ej. Hollywood Peel'} className={fieldClass} /></label>}
              {condition.condition_type === ConditionType.ReplyIdEquals && <label className="grid gap-1 text-[10px] text-wa-muted">ID del botón u opción<input maxLength={REPLY_ID_MAX_LENGTH} value={String(condition.value ?? '')} onChange={event => updateCondition(group.id, condition.id, { value: event.target.value })} placeholder="Ej. reply_1" className={`${fieldClass} font-mono`} /><span className="text-[10px] leading-snug">El ID que pusiste en la plantilla de botones o de lista, o el valor del botón en una plantilla oficial. No depende del texto que ve el cliente.</span></label>}
              {condition.condition_type === ConditionType.MessageTypeEquals && <Select value={String(condition.value ?? INBOUND_MESSAGE_TYPE_OPTIONS[0].value)} onChange={event => updateCondition(group.id, condition.id, { value: event.target.value })} className={fieldClass}>{INBOUND_MESSAGE_TYPE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</Select>}
              {condition.condition_type === ConditionType.SellerEquals && <Select value={String(condition.value ?? '')} onChange={event => updateCondition(group.id, condition.id, { value: Number(event.target.value) || null })} className={fieldClass}><option value="">Selecciona vendedor</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</Select>}
              {condition.condition_type === ConditionType.TagPresent && <Select value={String(condition.value ?? '')} onChange={event => updateCondition(group.id, condition.id, { value: Number(event.target.value) || null })} className={fieldClass}><option value="">Selecciona etiqueta</option>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</Select>}
            </div>
            {(group.conditions.length > 1 || groups.length > 1) && <button type="button" title="Quitar condición" onClick={() => removeCondition(group.id, condition.id)} className="mt-1 rounded p-1 text-wa-muted hover:bg-red-50 hover:text-red-500 dark:hover:bg-red-950/30"><X className="h-3.5 w-3.5" /></button>}
          </div>
        </div>)}
        <button type="button" disabled={group.conditions.length >= 10 || totalConditions >= 30} onClick={() => addAnd(group.id)} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-amber-300 px-2 py-1.5 text-[10px] font-semibold text-amber-700 disabled:opacity-40 dark:border-amber-800 dark:text-amber-300"><Plus className="h-3 w-3" />Agregar condición (Y)</button>
      </div>
    </div>)}
    <button type="button" disabled={groups.length >= 10 || totalConditions >= 30} onClick={addOrGroup} className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-wa-primary px-2 py-2 text-[10px] font-semibold text-wa-primary-strong disabled:opacity-40"><Plus className="h-3 w-3" />Agregar otra salida (O)</button>
    <div className="rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-[10px] font-semibold text-red-600 dark:border-red-900 dark:bg-red-950/20 dark:text-red-300">Si no se cumple ninguna → «Ninguna de las condiciones»</div>
    <p className="text-[10px] leading-relaxed text-wa-muted">Las comparaciones de mensajes usan el texto que inició o reanudó el flujo e ignoran mayúsculas, tildes y espacios repetidos.</p>
  </div>
}

function WaitDurationEditor({ seconds, onChange }: { seconds: number; onChange: (seconds: number) => void }) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = seconds % 60
  function commit(next: Partial<{ h: number; m: number; s: number }>) {
    const total = (next.h ?? hours) * 3600 + (next.m ?? minutes) * 60 + (next.s ?? secs)
    onChange(Math.max(1, Math.min(604800, total)))
  }
  return <div className="grid grid-cols-3 gap-2">
    <label className="grid gap-1 text-[10px] text-wa-muted">Horas<input type="number" min={0} max={168} value={hours} onChange={event => commit({ h: Number(event.target.value) || 0 })} className={fieldClass} /></label>
    <label className="grid gap-1 text-[10px] text-wa-muted">Minutos<input type="number" min={0} max={59} value={minutes} onChange={event => commit({ m: Number(event.target.value) || 0 })} className={fieldClass} /></label>
    <label className="grid gap-1 text-[10px] text-wa-muted">Segundos<input type="number" min={0} max={59} value={secs} onChange={event => commit({ s: Number(event.target.value) || 0 })} className={fieldClass} /></label>
  </div>
}

const WAIT_ANY_OPTIONAL_KINDS = [
  WaitAnyConditionKind.Message, WaitAnyConditionKind.MediaReceived,
  WaitAnyConditionKind.BusinessHours, WaitAnyConditionKind.MediaPlayed,
] as const

function WaitAnyEditor({ conditions, onChange }: { conditions: WaitAnyCondition[]; onChange: (conditions: WaitAnyCondition[]) => void }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const timer = conditions.find((c): c is Extract<WaitAnyCondition, { kind: typeof WaitAnyConditionKind.Timer }> => c.kind === WaitAnyConditionKind.Timer)
  const extra = conditions.filter(c => c.kind !== WaitAnyConditionKind.Timer)

  function toggle(kind: typeof WAIT_ANY_OPTIONAL_KINDS[number]) {
    const exists = conditions.some(c => c.kind === kind)
    onChange(exists ? conditions.filter(c => c.kind !== kind) : [...conditions, { id: kind, kind } as WaitAnyCondition])
  }

  return <div className="space-y-3">
    <div>
      <p className="mb-1 text-[10px] font-semibold text-wa-muted">Temporizador (obligatorio)</p>
      <WaitDurationEditor
        seconds={timer?.seconds ?? 1800}
        onChange={seconds => onChange(conditions.map(c => c.kind === WaitAnyConditionKind.Timer ? { ...c, seconds } : c))}
      />
    </div>
    {extra.length > 0 && <div className="space-y-1.5">
      {extra.map(condition => (
        <div key={condition.id} className="flex items-center justify-between rounded-lg border border-wa-border px-2.5 py-2 text-[11px] text-gray-700 dark:border-wa-border-dark dark:text-gray-300">
          <span>{WAIT_ANY_CONDITION_LABELS[condition.kind]}</span>
          <button type="button" onClick={() => toggle(condition.kind as typeof WAIT_ANY_OPTIONAL_KINDS[number])} title="Quitar condición" className="text-wa-muted hover:text-red-500"><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
    </div>}
    <div className="relative">
      <button type="button" onClick={() => setMenuOpen(current => !current)} className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-wa-border px-3 py-2 text-[11px] font-semibold text-wa-primary-strong hover:bg-wa-hover dark:border-wa-border-dark dark:hover:bg-wa-head-dark">
        <Plus className="h-3.5 w-3.5" />Agregar condición
      </button>
      {menuOpen && <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded-lg border border-wa-border bg-white py-1 shadow-lg dark:border-wa-border-dark dark:bg-wa-panel-dark">
        {WAIT_ANY_OPTIONAL_KINDS.map(kind => {
          const active = conditions.some(c => c.kind === kind)
          return <button key={kind} type="button" onClick={() => { toggle(kind); setMenuOpen(false) }} className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] text-gray-700 hover:bg-wa-hover dark:text-gray-300 dark:hover:bg-wa-head-dark">
            {WAIT_ANY_CONDITION_LABELS[kind]}
            {active && <Check className="h-3.5 w-3.5 text-wa-primary-strong" />}
          </button>
        })}
      </div>}
    </div>
    <p className="rounded-lg bg-cyan-50 p-2 text-[10px] text-cyan-700 dark:bg-cyan-950/30 dark:text-cyan-300">El lead sigue por la salida de lo que pase primero. Conecta cada condición; la del temporizador puede quedar sin conectar y ahí termina el flujo.</p>
  </div>
}

/** El backend reasigna los ids de los botones por posición al publicar
 *  (`btn_1`, `btn_2`, ...) — se deriva igual acá para que el handle que
 *  dibuja el lienzo mientras se edita sea siempre el mismo que va a quedar
 *  publicado. Si se borra un botón del medio, los siguientes corren su id
 *  (igual que sus conexiones): es el mismo comportamiento esperable de
 *  reordenar una lista con salidas propias por posición. */
function withPositionalButtonIds(labels: string[]): QuestionButton[] {
  return labels.map((label, index) => ({ id: `btn_${index + 1}`, label }))
}

function QuestionEditor({ text, buttons, timeoutSeconds, updateText, updateTimeout, updateButtons }: {
  text: string
  buttons: QuestionButton[]
  timeoutSeconds: number
  updateText: (text: string) => void
  updateTimeout: (seconds: number) => void
  updateButtons: (buttons: QuestionButton[]) => void
}) {
  return <div className="space-y-3">
    <label className="grid gap-1 text-[10px] text-wa-muted">Mensaje
      <textarea rows={3} value={text} onChange={event => updateText(event.target.value)} placeholder="Escribe la pregunta..." className={fieldClass} />
    </label>
    <div className="space-y-1.5">
      {buttons.map((button, index) => <div key={index} className="flex items-center gap-1.5">
        <input
          value={button.label} maxLength={20}
          onChange={event => updateButtons(withPositionalButtonIds(buttons.map((item, itemIndex) => itemIndex === index ? event.target.value : item.label)))}
          placeholder={`Botón ${index + 1}`} className={fieldClass}
        />
        <button type="button" disabled={buttons.length === 1} onClick={() => updateButtons(withPositionalButtonIds(buttons.filter((_, itemIndex) => itemIndex !== index).map(item => item.label)))} className="shrink-0 rounded-lg p-2 text-red-500 disabled:opacity-30"><X className="h-3.5 w-3.5" /></button>
      </div>)}
      <button
        type="button" disabled={buttons.length >= 3}
        onClick={() => updateButtons(withPositionalButtonIds([...buttons.map(item => item.label), '']))}
        className="flex items-center gap-1 text-[11px] font-semibold text-wa-primary-strong disabled:opacity-40"
      ><Plus className="h-3 w-3" />Agregar botón</button>
    </div>
    <div>
      <p className="mb-1 text-[10px] font-semibold text-wa-muted">Tiempo máximo para responder (obligatorio)</p>
      <WaitDurationEditor seconds={timeoutSeconds} onChange={updateTimeout} />
    </div>
    <p className="text-[10px] text-amber-600">Conecta cada botón, «Otra respuesta» y «Sin respuesta» a su propia salida. Si los botones no se pueden mostrar, la pregunta llega con las opciones numeradas.</p>
    <p className="rounded-lg bg-emerald-50 p-2 text-[10px] leading-relaxed text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">«Mandó una foto» es opcional: conéctala si pides una foto. Si no la conectas, una foto sale por «Otra respuesta».</p>
  </div>
}

/** Igual que los botones de Pregunta, el backend reasigna los ids por
 *  posición al publicar (`out_1`, `out_2`, ...): se deriva acá para que el
 *  handle dibujado sea el que va a quedar publicado. */
function withPositionalOutputIds(labels: string[]): RoundRobinOutput[] {
  return labels.map((label, index) => ({ id: `out_${index + 1}`, label }))
}

function RoundRobinEditor({ outputs, updateOutputs }: {
  outputs: RoundRobinOutput[]
  updateOutputs: (outputs: RoundRobinOutput[]) => void
}) {
  const labels = outputs.map(output => output.label)
  return <div className="space-y-3">
    <p className="rounded-lg bg-teal-50 p-2 text-[10px] leading-relaxed text-teal-700 dark:bg-teal-950/30 dark:text-teal-300">
      Cada lead que llega aquí sale por la siguiente salida de la lista; después de la última, vuelve a la primera. El turno se comparte entre todos los leads y se mantiene aunque vuelvas a publicar el flujo.
    </p>
    <div className="space-y-1.5">
      {outputs.map((output, index) => <div key={output.id} className="flex items-center gap-1.5">
        <span className="w-4 shrink-0 text-center text-[10px] font-bold text-teal-700 dark:text-teal-300">{index + 1}</span>
        <input
          value={output.label} maxLength={40}
          onChange={event => updateOutputs(withPositionalOutputIds(labels.map((label, labelIndex) => labelIndex === index ? event.target.value : label)))}
          placeholder={`Salida ${index + 1}`} className={fieldClass}
        />
        <button
          type="button" disabled={outputs.length <= 2} title={outputs.length <= 2 ? 'El reparto necesita al menos dos salidas' : 'Quitar salida'}
          onClick={() => updateOutputs(withPositionalOutputIds(labels.filter((_, labelIndex) => labelIndex !== index)))}
          className="shrink-0 rounded-lg p-2 text-red-500 disabled:opacity-30"
        ><X className="h-3.5 w-3.5" /></button>
      </div>)}
      <button
        type="button" disabled={outputs.length >= MAX_ROUND_ROBIN_OUTPUTS}
        onClick={() => updateOutputs(withPositionalOutputIds([...labels, `Salida ${labels.length + 1}`]))}
        className="flex items-center gap-1 text-[11px] font-semibold text-wa-primary-strong disabled:opacity-40"
      ><Plus className="h-3 w-3" />Agregar salida</button>
    </div>
    <p className="text-[10px] leading-relaxed text-wa-muted">Conecta todas las salidas: a cualquiera le puede tocar el próximo lead. El nombre solo sirve para ubicarla en el lienzo.</p>
  </div>
}

interface EntryConditionsEditorProps {
  conditions: AutomationConditions
  updateConditions: (conditions: AutomationConditions) => void
  users: AppUser[]
  tags: Tag[]
  highlightService?: string
}

function EntryConditionsEditor({ conditions, updateConditions, users, tags, highlightService }: EntryConditionsEditorProps) {
  const stageCatalog = useLeadStageCatalog()
  const serviceHighlighted = highlightService != null && conditionsNameService(conditions, highlightService)
  return <div className="space-y-4">
    <div className="flex items-start gap-2">
      <ListFilter className="mt-0.5 h-4 w-4 shrink-0 text-wa-primary-strong" />
      <div><p className="text-xs font-semibold text-wa-text dark:text-white">Condiciones de entrada</p><p className="mt-1 text-[10px] leading-relaxed text-wa-muted">El flujo solo empieza si el lead cumple todas estas condiciones. Para separar rutas dentro del flujo, usa un bloque Condición.</p></div>
    </div>
    <label className="grid gap-1 text-[10px] text-wa-muted">Etapa
      <Select value={conditions.stage ?? ''} onChange={event => updateConditions({ ...conditions, stage: event.target.value || null })} className={fieldClass}>
        <option value="">Cualquiera</option>
        {conditionStageOptions(stageCatalog, conditions.stage).map(stage => <option key={stage.key} value={stage.key}>{stage.is_active ? stage.name : `${stage.name} (inactiva)`}</option>)}
      </Select>
    </label>
    <label className="grid gap-1 text-[10px] text-wa-muted">Origen contiene
      <input maxLength={120} value={conditions.origin_contains ?? ''} onChange={event => updateConditions({ ...conditions, origin_contains: event.target.value })} placeholder="Ej. Facebook" className={fieldClass} />
    </label>
    <label data-highlighted={serviceHighlighted || undefined} className={`grid gap-1 text-[10px] text-wa-muted ${serviceHighlighted ? HIGHLIGHT_RING : ''}`}>Servicio de interés contiene
      <input maxLength={120} value={conditions.service_contains ?? ''} onChange={event => updateConditions({ ...conditions, service_contains: event.target.value })} placeholder="Ej. Limpieza" className={fieldClass} />
      <span className="text-[10px] text-wa-muted">Se aplica si el servicio de interés del lead incluye este texto, sin importar mayúsculas.</span>
    </label>
    <label className="grid gap-1 text-[10px] text-wa-muted">Vendedor
      <Select value={conditions.seller_id ?? ''} onChange={event => updateConditions({ ...conditions, seller_id: event.target.value ? Number(event.target.value) : null })} className={fieldClass}>
        <option value="">Cualquiera</option>
        {users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}
      </Select>
    </label>
    <label className="grid gap-1 text-[10px] text-wa-muted">Etiqueta
      <Select value={conditions.tag_id ?? ''} onChange={event => updateConditions({ ...conditions, tag_id: event.target.value ? Number(event.target.value) : null })} className={fieldClass}>
        <option value="">Cualquiera</option>
        {tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
      </Select>
    </label>
    <div className="space-y-2 rounded-xl border border-wa-border p-3 dark:border-wa-border-dark">
      <label className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300"><Checkbox checked={!!conditions.require_open_window} onChange={event => updateConditions({ ...conditions, require_open_window: event.target.checked })} />Ventana de 24 h abierta (el cliente escribió hace menos de 24 h)</label>
      <label className="flex items-center gap-2 text-[11px] text-gray-600 dark:text-gray-300"><Checkbox checked={!!conditions.business_hours_only} onChange={event => updateConditions({ ...conditions, business_hours_only: event.target.checked })} />Horario laboral (lunes a viernes, 08:00–18:00)</label>
    </div>
    <label className="grid gap-1 text-[10px] text-wa-muted">No repetir para el mismo lead durante (minutos)
      <input type="number" min={1} max={43200} placeholder="Sin límite" value={conditions.cooldown_minutes ?? ''} onChange={event => updateConditions({ ...conditions, cooldown_minutes: event.target.value ? Number(event.target.value) : null })} className={fieldClass} />
      <span className="font-normal text-[10px] text-wa-muted">Evita que el flujo se repita para el mismo lead si escribe varias veces seguidas. Muy recomendable en flujos disparados por "Mensaje recibido".</span>
    </label>
    <button type="button" onClick={() => updateConditions({})} className="w-full rounded-lg border border-wa-border px-3 py-2 text-[11px] font-semibold text-wa-muted hover:bg-wa-hover dark:border-wa-border-dark dark:hover:bg-wa-head-dark">Limpiar condiciones</button>
  </div>
}

interface ActionEditorProps {
  action: AutomationAction
  updateAction: (action: AutomationAction) => void
  users: Array<{ id: number; name: string }>
  tags: Array<{ id: number; name: string }>
  leadServices: Array<{ id: number; name: string }>
  templates: MessageTemplate[]
  mediaAssets: MediaAsset[]
  highlightService?: string
}

function TemplatePreview({ template }: { template: MessageTemplate }) {
  return <div className="space-y-1.5 rounded-lg border border-wa-border bg-wa-hover p-2 dark:border-wa-border-dark dark:bg-wa-head-dark">
    <p className="whitespace-pre-wrap text-[11px] text-wa-text dark:text-wa-text-dark">{template.content || <span className="italic text-wa-muted">(sin texto, solo adjuntos)</span>}</p>
    {template.attachments.length > 0 && <div className="flex flex-wrap gap-1.5">
      {template.attachments.map(attachment => <AttachmentPreview key={attachment.id} attachment={attachment} />)}
    </div>}
  </div>
}

function ActionEditor({ action, updateAction, users, tags, leadServices, templates, mediaAssets, highlightService }: ActionEditorProps) {
  const [creatingTemplate, setCreatingTemplate] = useState(false)
  const stageCatalog = useLeadStageCatalog()
  const selectedTemplate = action.type === ActionType.SendTemplate
    ? templates.find(template => template.id === action.template_id) ?? null
    : null
  return <div className="space-y-3"><label className="grid gap-1 text-[10px] text-wa-muted">Acción<Select value={action.type} onChange={event => { if (isAutomationActionType(event.target.value)) updateAction(defaultAction(event.target.value)) }} className={fieldClass}>{actionTypeOptions()}</Select></label>
    {action.type === ActionType.CreateTask && <><label className="grid gap-1 text-[10px] text-wa-muted">Título<input value={action.title} onChange={event => updateAction({ ...action, title: event.target.value })} className={fieldClass} /></label><label className="grid gap-1 text-[10px] text-wa-muted">Descripción<textarea rows={2} value={action.description ?? ''} onChange={event => updateAction({ ...action, description: event.target.value })} className={fieldClass} /></label><div className="grid grid-cols-2 gap-2"><label className="grid gap-1 text-[10px] text-wa-muted">Tipo<Select value={action.task_type} onChange={event => { const value = event.target.value; if (isTaskType(value)) updateAction({ ...action, task_type: value }) }} className={fieldClass}>{TASK_TYPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></label><label className="grid gap-1 text-[10px] text-wa-muted">Prioridad<Select value={action.priority} onChange={event => { const value = event.target.value; if (isTaskPriority(value)) updateAction({ ...action, priority: value }) }} className={fieldClass}>{TASK_PRIORITY_OPTIONS.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</Select></label><label className="grid gap-1 text-[10px] text-wa-muted">Vence en (minutos)<input type="number" min={1} max={43200} value={action.due_minutes} onChange={event => updateAction({ ...action, due_minutes: Number(event.target.value) })} className={fieldClass} /></label><label className="grid gap-1 text-[10px] text-wa-muted">Recordar antes (minutos)<input type="number" min={0} value={action.remind_minutes_before} onChange={event => updateAction({ ...action, remind_minutes_before: Number(event.target.value) })} className={fieldClass} /></label></div><label className="grid gap-1 text-[10px] text-wa-muted">Responsable<Select value={action.assigned_user_id ?? ''} onChange={event => updateAction({ ...action, assigned_user_id: Number(event.target.value) || null })} className={fieldClass}><option value="">Vendedor del lead</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</Select></label></>}
    {action.type === ActionType.AssignSeller && <Select value={action.user_id ?? ''} onChange={event => updateAction({ ...action, user_id: Number(event.target.value) || null })} className={fieldClass}><option value="">Selecciona vendedor</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</Select>}
    {(action.type === ActionType.AddTag || action.type === ActionType.RemoveTag) && <Select value={action.tag_id ?? ''} onChange={event => updateAction({ ...action, tag_id: Number(event.target.value) || null })} className={fieldClass}><option value="">Selecciona etiqueta</option>{tags.map(tag => <option key={tag.id} value={tag.id}>{tag.name}</option>)}</Select>}
    {action.type === ActionType.ChangeStage && <Select value={action.stage} onChange={event => updateAction({ ...action, stage: event.target.value })} className={fieldClass}>{stageOptions(stageCatalog, action.stage).map(stage => <option key={stage.key} value={stage.key} disabled={!stage.is_active}>{stage.is_active ? stage.name : `${stage.name} (inactiva)`}</option>)}</Select>}
    {action.type === ActionType.ChangeService && <div data-highlighted={(highlightService != null && actionNamesService(action, highlightService)) || undefined} className="space-y-3 data-[highlighted=true]:rounded-lg data-[highlighted=true]:bg-amber-50 data-[highlighted=true]:p-1.5 data-[highlighted=true]:ring-2 data-[highlighted=true]:ring-amber-400 dark:data-[highlighted=true]:bg-amber-950/30"><Select value={action.service ?? ''} onChange={event => updateAction({ ...action, service: event.target.value || null })} className={fieldClass}><option value="">Quitar servicio de interés</option>{action.service && !leadServices.some(service => service.name === action.service) && <option value={action.service}>{action.service} (valor actual)</option>}{leadServices.map(service => <option key={service.id} value={service.name}>{service.name}</option>)}</Select><p className="text-[10px] text-wa-muted">Es el tratamiento que le interesa al lead. Para marcar de qué anuncio vino, usa «Agregar etiqueta». Déjalo vacío para quitar el actual.</p></div>}
    {action.type === ActionType.SetConversationState && <><Select value={action.state} onChange={event => updateAction({ ...action, state: event.target.value === 'open' ? 'open' : 'closed' })} className={fieldClass}><option value="open">Abrir conversación</option><option value="closed">Cerrar conversación</option></Select><p className="text-[10px] text-wa-muted">Abrirla desde aquí no inicia los flujos de «Conversación nueva»: esos solo empiezan con un mensaje del cliente.</p></>}
    {action.type === ActionType.SendAudio && <MediaAssetField mediaAssetId={action.media_asset_id} mediaAssets={mediaAssets} kind="audio" onChange={id => updateAction({ ...action, media_asset_id: id })} />}
    {action.type === ActionType.SendAttachment && <MediaAssetField mediaAssetId={action.media_asset_id} mediaAssets={mediaAssets} onChange={id => updateAction({ ...action, media_asset_id: id })} />}
    {action.type === ActionType.SendMedia && <><MediaAssetField mediaAssetId={action.media_asset_id} mediaAssets={mediaAssets} onChange={id => updateAction({ ...action, media_asset_id: id })} /><label className="grid gap-1 text-[10px] text-wa-muted">Texto que acompaña al archivo<textarea rows={4} maxLength={1024} value={action.caption} onChange={event => updateAction({ ...action, caption: event.target.value })} placeholder="Ej. Hola {{nombre}}, mira este contenido…" className={fieldClass} /></label><p className="text-[10px] leading-relaxed text-wa-muted">En imágenes, videos y documentos el texto va junto al archivo. En audios llega como mensaje aparte, justo después.</p></>}
    {action.type === ActionType.ReactToLastCustomerMessage && <AutomationReactionPicker emoji={action.emoji} onChange={emoji => updateAction({ ...action, emoji })} />}
    {action.type === ActionType.Notify && <><Select value={action.recipient} onChange={event => updateAction({ ...action, recipient: event.target.value === AutomationRecipient.Specific ? AutomationRecipient.Specific : AutomationRecipient.Seller, user_id: null })} className={fieldClass}><option value={AutomationRecipient.Seller}>Vendedor del lead</option><option value={AutomationRecipient.Specific}>Usuario específico</option></Select>{action.recipient === AutomationRecipient.Specific && <Select value={action.user_id ?? ''} onChange={event => updateAction({ ...action, user_id: Number(event.target.value) || null })} className={fieldClass}><option value="">Selecciona usuario</option>{users.map(user => <option key={user.id} value={user.id}>{user.name}</option>)}</Select>}<input value={action.title} onChange={event => updateAction({ ...action, title: event.target.value })} placeholder="Título" className={fieldClass} /><textarea rows={3} value={action.body} onChange={event => updateAction({ ...action, body: event.target.value })} placeholder="Contenido" className={fieldClass} /></>}
    {action.type === ActionType.SendMessage && <textarea rows={4} value={action.text} onChange={event => updateAction({ ...action, text: event.target.value })} placeholder="Escribe el mensaje a enviar..." className={fieldClass} />}
    {action.type === ActionType.SendTemplate && <>
      <div className="flex items-center gap-1.5">
        <Select value={action.template_id ?? ''} onChange={event => updateAction({ ...action, template_id: Number(event.target.value) || null })} className={fieldClass}><option value="">Selecciona plantilla</option>{templates.map(template => <option key={template.id} value={template.id}>{template.name}</option>)}</Select>
        <button type="button" onClick={() => setCreatingTemplate(true)} title="Crear plantilla nueva sin salir del flujo" className="flex shrink-0 items-center gap-1 rounded-lg border border-wa-border px-2 py-2 text-[10px] font-semibold text-wa-muted hover:bg-wa-hover dark:border-wa-border-dark dark:hover:bg-wa-head-dark"><Plus className="h-3 w-3" />Nueva</button>
      </div>
      {selectedTemplate && <TemplatePreview template={selectedTemplate} />}
      <p className="text-[10px] text-amber-600">Puede llevar imagen, video, audio o documento. Solo se envía si el cliente escribió en las últimas 24 horas.</p>
      {creatingTemplate && <CreateTemplateDialog
        onClose={() => setCreatingTemplate(false)}
        onCreated={template => { updateAction({ ...action, template_id: template.id }); setCreatingTemplate(false) }}
      />}
    </>}
    <div className="rounded-lg bg-wa-hover p-2 text-[10px] text-wa-muted dark:bg-wa-head-dark"><MessageSquareText className="mr-1 inline h-3 w-3" />Variables: {'{{nombre}}'}, {'{{telefono}}'}, {'{{servicio}}'}, {'{{vendedor}}'}, {'{{fecha_actual}}'}.</div>
  </div>
}
