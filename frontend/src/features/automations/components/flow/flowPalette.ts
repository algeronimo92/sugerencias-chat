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
  { type: FlowNodeType.Condition, label: FLOW_NODE_LABELS[FlowNodeType.Condition], icon: Split, description: 'Elige la ruta según el lead o su mensaje' },
  { type: FlowNodeType.Action, label: FLOW_NODE_LABELS[FlowNodeType.Action], icon: Activity, description: 'Envía, etiqueta, asigna o crea una tarea' },
  { type: FlowNodeType.InvokeFlow, label: FLOW_NODE_LABELS[FlowNodeType.InvokeFlow], icon: CirclePlay, description: 'Inicia otro flujo para este lead' },
  { type: FlowNodeType.WaitAny, label: FLOW_NODE_LABELS[FlowNodeType.WaitAny], icon: Timer, description: 'Espera un tiempo o una respuesta del lead' },
  { type: FlowNodeType.Question, label: FLOW_NODE_LABELS[FlowNodeType.Question], icon: MessageCircleQuestion, description: 'Pregunta con botones; una ruta por respuesta' },
  { type: FlowNodeType.RoundRobin, label: FLOW_NODE_LABELS[FlowNodeType.RoundRobin], icon: Repeat, description: 'Reparte los leads por turnos entre varias salidas' },
  { type: FlowNodeType.End, label: FLOW_NODE_LABELS[FlowNodeType.End], icon: CheckCircle2, description: 'Termina esta ruta' },
]
