import { AutomationActionType, AutomationRecipient, AutomationTrigger, FlowHandle, FlowNodeType } from './automationCatalog'
import type { AutomationAction, AutomationFlowDefinition, AutomationFlowNode, AutomationTrigger as Trigger } from '../types'

/** Con qué arranca el editor un flujo nuevo. */
export interface FlowStarter {
  name: string
  definition: AutomationFlowDefinition
}

export type RecipeSection = 'automatic' | 'sequences'

/**
 * Una receta: un flujo ya armado para algo que casi toda clínica quiere, que
 * la persona ajusta en vez de construir desde el lienzo vacío.
 *
 * El editor abría siempre con «Lead nuevo → Crear tarea → Fin», que no es lo
 * que nadie venía a hacer. DermicaPro armó a mano sus 16 flujos y los más
 * usados son justo estos: bienvenida, seguimiento y mensajes de precio.
 *
 * Los textos son un punto de partida a propósito genérico: no prometen
 * precios ni horarios que no conocemos. Nada se guarda ni se publica al
 * elegir una receta: el flujo nace como borrador sin guardar.
 */
export interface FlowRecipe {
  id: string
  section: RecipeSection
  title: string
  /** Cuándo corre, en una línea. */
  when: string
  /** Qué hace, en una línea. */
  does: string
  build: () => FlowStarter
}

const COLUMN = 320
const ROW = 220

type Step =
  | { action: AutomationAction }
  | { waitSeconds: number }

/** Arma un flujo en línea: disparador, los pasos en orden y un fin. */
function linear(trigger: { type: Trigger; minutes?: number }, steps: Step[], conditions: AutomationFlowDefinition['conditions'] = {}): AutomationFlowDefinition {
  const nodes: AutomationFlowNode[] = [{
    id: 'trigger-1', type: FlowNodeType.Trigger, position: { x: 70, y: ROW },
    data: trigger.minutes ? { trigger_type: trigger.type, minutes: trigger.minutes } : { trigger_type: trigger.type },
  }]
  steps.forEach((step, index) => {
    const position = { x: 70 + COLUMN * (index + 1), y: ROW }
    nodes.push('action' in step
      ? { id: `action-${index + 1}`, type: FlowNodeType.Action, position, data: { action: step.action } }
      : { id: `wait-${index + 1}`, type: FlowNodeType.Wait, position, data: { seconds: step.waitSeconds } })
  })
  nodes.push({
    id: 'end-1', type: FlowNodeType.End, position: { x: 70 + COLUMN * (steps.length + 1), y: ROW },
    data: { label: 'Fin', close_conversation: false },
  })
  const edges = nodes.slice(0, -1).map((node, index) => ({
    id: `edge-${node.id}-${nodes[index + 1].id}`, source: node.id, target: nodes[index + 1].id, source_handle: FlowHandle.Next,
  }))
  return { conditions, nodes, edges }
}

const message = (text: string): Step => ({ action: { type: AutomationActionType.SendMessage, text } })

export const FLOW_RECIPES: FlowRecipe[] = [
  {
    id: 'bienvenida',
    section: 'automatic',
    title: 'Dar la bienvenida',
    when: 'Cuando un cliente abre una conversación.',
    does: 'Le responde al instante para que no espere a que alguien esté libre.',
    build: () => ({
      name: 'Bienvenida',
      definition: linear({ type: AutomationTrigger.ConversationStarted }, [
        message('¡Hola {{nombre}}! Gracias por escribirnos. En un momento te atiende alguien de nuestro equipo. ¿En qué tratamiento estás pensando?'),
      ]),
    }),
  },
  {
    id: 'cliente-sin-responder',
    section: 'automatic',
    title: 'Retomar si el cliente no responde',
    when: 'Cuando pasan 3 horas sin respuesta del cliente.',
    does: 'Le escribe una vez para retomar, solo si WhatsApp todavía lo permite.',
    build: () => ({
      name: 'Seguimiento si no responde',
      definition: linear(
        { type: AutomationTrigger.CustomerResponseOverdue, minutes: 180 },
        [message('Hola {{nombre}}, ¿pudiste ver lo que te enviamos? Si tienes alguna duda, cuéntame y te ayudo.')],
        // Pasadas 24 h WhatsApp rechaza un mensaje libre: mejor no intentarlo.
        // Y si una vendedora ya retomó la conversación, el recordatorio sobra.
        { require_open_window: true, stop_when_team_replies: true },
      ),
    }),
  },
  {
    id: 'vendedora-sin-responder',
    section: 'automatic',
    title: 'Avisar si el cliente queda esperando',
    when: 'Cuando pasan 15 minutos sin que tu equipo responda.',
    does: 'Le manda un aviso a la vendedora del lead. Al cliente no le escribe nada.',
    build: () => ({
      name: 'Aviso de cliente esperando',
      definition: linear({ type: AutomationTrigger.SellerResponseOverdue, minutes: 15 }, [{
        action: {
          type: AutomationActionType.Notify, recipient: AutomationRecipient.Seller, user_id: null,
          title: 'Cliente esperando respuesta', body: '{{nombre}} escribió hace 15 minutos y todavía no tiene respuesta.',
        },
      }]),
    }),
  },
  {
    id: 'precios',
    section: 'sequences',
    title: 'Enviar precios',
    when: 'Cuando la vendedora la lanza desde el chat.',
    does: 'Manda dos mensajes seguidos: el precio y una invitación a agendar.',
    build: () => ({
      name: 'Precio de …',
      definition: linear({ type: AutomationTrigger.Manual }, [
        message('{{nombre}}, te cuento sobre {{servicio}}: escribe aquí el precio y lo que incluye.'),
        { waitSeconds: 60 },
        message('¿Te gustaría separar tu cita? Dime qué día te queda mejor y lo coordinamos.'),
      ]),
    }),
  },
  {
    id: 'ubicacion',
    section: 'sequences',
    title: 'Enviar ubicación e indicaciones',
    when: 'Cuando la vendedora la lanza desde el chat.',
    does: 'Manda la dirección y cómo llegar, siempre con el mismo texto.',
    build: () => ({
      name: 'Ubicación',
      definition: linear({ type: AutomationTrigger.Manual }, [
        message('Estamos en: escribe aquí la dirección y una referencia para llegar. Atendemos con cita previa.'),
      ]),
    }),
  },
]

export function recipesFor(section: RecipeSection): FlowRecipe[] {
  return FLOW_RECIPES.filter(recipe => recipe.section === section)
}
