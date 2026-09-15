import { Activity, CheckCircle2, CirclePlay, MessageCircleQuestion, Repeat, Split, Timer, Zap, type LucideIcon } from 'lucide-react'
import type {
  AutomationAction, AutomationFlowConditionGroup, AutomationFlowConditionType, AutomationFlowNodeType, AutomationTrigger,
  QuestionButton, RoundRobinOutput, WaitAnyCondition,
} from '../types'
import {
  AUTOMATION_ACTION_LABELS, AUTOMATION_TRIGGERS, FLOW_CONDITION_LABELS, FlowNodeType, formatWaitDuration,
  isAutomationActionType, isFlowConditionType, WaitAnyConditionKind,
} from './automationCatalog'

export interface FlowNodeSummaryData {
  trigger_type?: AutomationTrigger
  condition_type?: AutomationFlowConditionType
  condition_groups?: AutomationFlowConditionGroup[]
  action?: AutomationAction
  invokedFlowName?: string
  seconds?: number
  conditions?: WaitAnyCondition[]
  buttons?: QuestionButton[]
  outputs?: RoundRobinOutput[]
  label?: string
}

export interface FlowNodeView {
  icon: LucideIcon
  iconClass: string
  summary: (data: FlowNodeSummaryData) => string
}

function conditionSummary(data: FlowNodeSummaryData): string {
  const first = data.condition_groups?.[0]?.conditions[0]
  const condition = String(first?.condition_type ?? data.condition_type ?? '')
  const count = data.condition_groups?.reduce((sum, group) => sum + group.conditions.length, 0) ?? 1
  const label = isFlowConditionType(condition) ? FLOW_CONDITION_LABELS[condition] : 'Condición'
  return `${label}${count > 1 ? ` (+${count - 1})` : ''}`
}

function waitAnySummary(data: FlowNodeSummaryData): string {
  const conditions = data.conditions ?? []
  const timer = conditions.find(condition => condition.kind === WaitAnyConditionKind.Timer)
  const waitedFor = [
    conditions.some(condition => condition.kind === WaitAnyConditionKind.Message) && 'mensaje',
    conditions.some(condition => condition.kind === WaitAnyConditionKind.MediaReceived) && 'foto',
  ].filter(Boolean).join(' o ')
  const timerLabel = timer ? formatWaitDuration(timer.seconds) : ''
  return waitedFor ? `${timerLabel} o ${waitedFor}` : timerLabel
}

export const FLOW_NODE_VIEW: Record<AutomationFlowNodeType, FlowNodeView> = {
  [FlowNodeType.Trigger]: {
    icon: Zap,
    iconClass: 'text-wa-primary-strong',
    summary: data => AUTOMATION_TRIGGERS.find(item => item.value === data.trigger_type)?.label ?? 'Disparador',
  },
  [FlowNodeType.Condition]: { icon: Split, iconClass: 'text-amber-600', summary: conditionSummary },
  [FlowNodeType.Action]: {
    icon: Activity,
    iconClass: 'text-violet-600',
    summary: data => {
      const actionType = String(data.action?.type ?? '')
      return isAutomationActionType(actionType) ? AUTOMATION_ACTION_LABELS[actionType] : 'Acción'
    },
  },
  [FlowNodeType.InvokeFlow]: {
    icon: CirclePlay,
    iconClass: 'text-indigo-600',
    summary: data => data.invokedFlowName ?? 'Selecciona un flujo',
  },
  [FlowNodeType.Wait]: {
    icon: Timer,
    iconClass: 'text-cyan-600',
    summary: data => `Esperar ${formatWaitDuration(Number(data.seconds ?? 0))}`,
  },
  [FlowNodeType.WaitAny]: { icon: Timer, iconClass: 'text-cyan-600', summary: waitAnySummary },
  [FlowNodeType.Question]: {
    icon: MessageCircleQuestion,
    iconClass: 'text-pink-600',
    summary: data => data.buttons?.length ? data.buttons.map(button => button.label).join(' / ') : 'Sin botones',
  },
  [FlowNodeType.RoundRobin]: {
    icon: Repeat,
    iconClass: 'text-teal-600',
    summary: data => data.outputs?.length ? `Reparto entre ${data.outputs.length} salidas` : 'Sin salidas',
  },
  [FlowNodeType.End]: { icon: CheckCircle2, iconClass: 'text-wa-muted', summary: data => String(data.label || 'Fin') },
}

export function flowNodeSummary(type: AutomationFlowNodeType, data: FlowNodeSummaryData): string {
  return FLOW_NODE_VIEW[type].summary(data)
}
