import type { MessageTemplate } from '../../templates/types'
import type { AutomationAction, AutomationFlowEdge, QuestionButton, TemplateReply } from '../types'
import { AutomationActionType, FlowHandle, QuestionHandle } from './automationCatalog'

/**
 * «Seguir según el botón que toque» de un paso Enviar plantilla (2026-11-27).
 *
 * Una plantilla de Meta con botones de respuesta rápida tenía una sola salida
 * («Siguiente»): para llevar al cliente por una ruta distinta según el botón
 * había que agregar una Espera y una Condición por cada uno. Con el ajuste
 * encendido el paso tiene una salida por botón, más «Otra respuesta» y «Sin
 * respuesta», igual que una Pregunta.
 */
export const DEFAULT_REPLY_TIMEOUT_SECONDS = 86400

/** El texto de cada botón de respuesta rápida de la plantilla, en orden. Los
 *  de enlace o teléfono no cuentan: tocarlos no manda ningún mensaje. Espejo
 *  de `quick_reply_labels` (backend, `automations/domain/templates.py`). */
export function templateQuickReplies(template: Pick<MessageTemplate, 'template_type' | 'official_buttons'> | null | undefined): string[] {
  if (!template || template.template_type !== 'official') return []
  return template.official_buttons
    .filter(button => button.type === 'quick_reply')
    .map(button => button.text.trim())
    .filter(Boolean)
}

/** Mismo id posicional que los botones de una Pregunta: el backend los
 *  reasigna igual al publicar. */
export function replyButtons(labels: readonly string[]): QuestionButton[] {
  return labels.map((label, index) => ({ id: `btn_${index + 1}`, label }))
}

export function newTemplateReply(labels: readonly string[], timeoutSeconds = DEFAULT_REPLY_TIMEOUT_SECONDS): TemplateReply {
  return { buttons: replyButtons(labels), timeout_seconds: timeoutSeconds }
}

/** La plantilla cambió sus botones después de armar el paso: las salidas
 *  dibujadas ya no son lo que verá el cliente, y publicar lo rechaza. */
export function replyIsOutdated(reply: TemplateReply, labels: readonly string[]): boolean {
  return reply.buttons.length !== labels.length || reply.buttons.some((button, index) => button.label !== labels[index])
}

/** El ajuste después de cambiar la acción del paso: se apaga si deja de ser
 *  una plantilla o si la nueva no tiene respuestas rápidas, y toma los
 *  botones de la plantilla nueva si se eligió otra. */
export function replyAfterActionChange(
  reply: TemplateReply | undefined,
  previous: AutomationAction,
  next: AutomationAction,
  templates: readonly MessageTemplate[],
): TemplateReply | undefined {
  if (!reply || next.type !== AutomationActionType.SendTemplate) return undefined
  if (previous.type === AutomationActionType.SendTemplate && previous.template_id === next.template_id) return reply
  const labels = templateQuickReplies(templates.find(template => template.id === next.template_id))
  return labels.length > 0 ? newTemplateReply(labels, reply.timeout_seconds) : undefined
}

/**
 * Las conexiones del flujo después de cambiar el ajuste de un paso: se quitan
 * las de las salidas que el paso ya no tiene.
 *
 * Cada botón conserva su conexión si la plantilla nueva tiene uno con el mismo
 * texto, esté en la posición que esté: la conexión pasa a su número nuevo. Si
 * a «Sí / No / Tal vez» le quitan «No», «Tal vez» sigue yendo a donde iba
 * aunque ahora sea `btn_2`. Un botón con otro texto no hereda nada: al cambiar
 * «Sí / No» por «Confirmar / Reprogramar», dejar «Confirmar» conectado a donde
 * iba «Sí» publicaría una ruta que nadie eligió.
 */
export function edgesAfterReplyChange(
  edges: AutomationFlowEdge[],
  nodeId: string,
  previous: TemplateReply | undefined,
  next: TemplateReply | undefined,
): AutomationFlowEdge[] {
  if (!previous && !next) return edges
  // Encender quita «Siguiente»; apagar quita todas las salidas de respuesta.
  if (!previous || !next) {
    const kept: string = next ? '' : FlowHandle.Next
    return edges.filter(edge => edge.source !== nodeId || edge.source_handle === kept)
  }
  const idNow = new Map(next.buttons.map(button => [button.label, button.id]))
  const moved = new Map<string, string | undefined>(previous.buttons.map(button => [button.id, idNow.get(button.label)]))
  const result: AutomationFlowEdge[] = []
  for (const edge of edges) {
    if (edge.source !== nodeId || edge.source_handle === QuestionHandle.Other || edge.source_handle === QuestionHandle.Timeout) {
      result.push(edge)
      continue
    }
    const handle = moved.get(edge.source_handle)
    if (handle) result.push(handle === edge.source_handle ? edge : { ...edge, source_handle: handle })
  }
  return result
}
