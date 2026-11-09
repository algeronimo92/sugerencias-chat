import { MessageSquareText, type LucideIcon } from 'lucide-react'
import { AutomationActionType, FlowNodeType } from './automationCatalog'
import type { AutomationFlowNodeType } from '../types'

/**
 * El color de cada tipo de bloque, el mismo en claro y en oscuro (2026-11-08).
 *
 * Antes el modo oscuro tenía 4 colores para 9 tipos: acción y fin azules,
 * condición y pregunta ámbar, disparador, pausa y reparto grises. Y el ámbar
 * es también el color de "revisar este bloque", así que en un flujo grande no
 * se distinguía una pregunta de un bloque marcado. Ahora el ámbar (y el rojo)
 * quedan solo para estados, y "Mensaje" deja de verse igual que "Acción".
 *
 * Las franjas pasan 3:1 contra la tarjeta (600 en claro, 400 en oscuro).
 * Pausa, Iniciar otro flujo y Fin van neutros: se reconocen por su icono.
 */
export type FlowTone = 'trigger' | 'message' | 'action' | 'condition' | 'question' | 'roundRobin' | 'neutral'

interface ToneStyle {
  /** Franja izquierda de la tarjeta. */
  border: string
  /** Icono del tipo (tarjeta, barra lateral, panel). */
  icon: string
  /** Para el minimapa, que pinta en SVG: [claro, oscuro]. */
  fill: readonly [string, string]
}

export const FLOW_TONES: Record<FlowTone, ToneStyle> = {
  trigger: { border: 'border-l-emerald-600 dark:border-l-emerald-400', icon: 'text-emerald-600 dark:text-emerald-400', fill: ['#059669', '#34d399'] },
  message: { border: 'border-l-sky-600 dark:border-l-sky-400', icon: 'text-sky-600 dark:text-sky-400', fill: ['#0284c7', '#38bdf8'] },
  action: { border: 'border-l-violet-600 dark:border-l-violet-400', icon: 'text-violet-600 dark:text-violet-400', fill: ['#7c3aed', '#a78bfa'] },
  condition: { border: 'border-l-teal-600 dark:border-l-teal-400', icon: 'text-teal-600 dark:text-teal-400', fill: ['#0d9488', '#2dd4bf'] },
  question: { border: 'border-l-pink-600 dark:border-l-pink-400', icon: 'text-pink-600 dark:text-pink-400', fill: ['#db2777', '#f472b6'] },
  roundRobin: { border: 'border-l-lime-600 dark:border-l-lime-400', icon: 'text-lime-600 dark:text-lime-400', fill: ['#65a30d', '#a3e635'] },
  neutral: { border: 'border-l-slate-500 dark:border-l-slate-400', icon: 'text-slate-500 dark:text-slate-400', fill: ['#64748b', '#94a3b8'] },
}

/** Lo que no es un tipo: "revisar" (marcado desde Catálogos) en el minimapa. */
export const FLAGGED_FILL: readonly [string, string] = ['#f59e0b', '#fbbf24']

const MESSAGE_ACTIONS: ReadonlySet<string> = new Set([
  AutomationActionType.SendMessage,
  AutomationActionType.SendTemplate,
  AutomationActionType.SendAudio,
  AutomationActionType.SendAttachment,
  AutomationActionType.SendMedia,
])

/** Una acción que le escribe al cliente es un "Mensaje": otro color y otro icono. */
export function isMessageAction(actionType: unknown): boolean {
  return typeof actionType === 'string' && MESSAGE_ACTIONS.has(actionType)
}

export function flowTone(type: AutomationFlowNodeType | string | undefined, actionType?: unknown): FlowTone {
  switch (type) {
    case FlowNodeType.Trigger: return 'trigger'
    case FlowNodeType.Action: return isMessageAction(actionType) ? 'message' : 'action'
    case FlowNodeType.Condition: return 'condition'
    case FlowNodeType.Question: return 'question'
    case FlowNodeType.RoundRobin: return 'roundRobin'
    default: return 'neutral'
  }
}

/** El icono de "Mensaje"; el resto usa el de su tipo (FLOW_NODE_VIEW). */
export const MESSAGE_ICON: LucideIcon = MessageSquareText

/**
 * Cuánto agrandar el #n para que se vea de ~11 px en pantalla con cualquier
 * zoom por debajo de 1,1 (hasta 6 veces, con el zoom mínimo de 0,2). En pasos
 * de 0,25: el lienzo no recalcula estilos en cada fotograma del zoom.
 */
export function numberScale(zoom: number): number {
  if (!(zoom > 0)) return 1
  const scale = Math.min(6, Math.max(1, 1.1 / zoom))
  return Math.round(scale * 4) / 4
}

/** Color de un bloque en el minimapa: el de su tipo, o ámbar si está marcado. */
export function minimapFill(type: string | undefined, actionType: unknown, flagged: boolean, dark: boolean): string {
  const [light, darkFill] = flagged ? FLAGGED_FILL : FLOW_TONES[flowTone(type, actionType)].fill
  return dark ? darkFill : light
}
