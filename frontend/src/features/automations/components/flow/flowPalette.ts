import { Activity, CheckCircle2, CirclePlay, MessageCircleQuestion, Repeat, Split, Timer, type LucideIcon } from 'lucide-react'
import { FLOW_NODE_LABELS, FlowNodeType } from '../../domain/automationCatalog'
import type { AutomationFlowNodeType } from '../../types'

export interface FlowPaletteItem {
  type: AutomationFlowNodeType
  label: string
  icon: LucideIcon
  description: string
}

/** Los bloques que se pueden agregar: la barra lateral (arrastrar) y el menú
 *  que aparece al soltar una conexión en el vacío usan esta misma lista. */
export const FLOW_PALETTE: FlowPaletteItem[] = [
  { type: FlowNodeType.Condition, label: FLOW_NODE_LABELS[FlowNodeType.Condition], icon: Split, description: 'Rama Sí/No' },
  { type: FlowNodeType.Action, label: FLOW_NODE_LABELS[FlowNodeType.Action], icon: Activity, description: 'Ejecuta una operación' },
  { type: FlowNodeType.InvokeFlow, label: FLOW_NODE_LABELS[FlowNodeType.InvokeFlow], icon: CirclePlay, description: 'Inicia otro flujo para este lead' },
  { type: FlowNodeType.WaitAny, label: FLOW_NODE_LABELS[FlowNodeType.WaitAny], icon: Timer, description: 'Continúa cuando ocurra la primera condición' },
  { type: FlowNodeType.Question, label: FLOW_NODE_LABELS[FlowNodeType.Question], icon: MessageCircleQuestion, description: 'Botones con una rama por respuesta' },
  { type: FlowNodeType.RoundRobin, label: FLOW_NODE_LABELS[FlowNodeType.RoundRobin], icon: Repeat, description: 'Reparte los leads por turnos entre N salidas' },
  { type: FlowNodeType.End, label: FLOW_NODE_LABELS[FlowNodeType.End], icon: CheckCircle2, description: 'Termina esta ruta' },
]
