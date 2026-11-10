import type { AutomationFlowEdge, AutomationFlowNode } from '../types'
import { FlowHandle, FlowNodeType } from './automationCatalog'

/** Bloques con una sola salida ("Siguiente"): lo nuevo se puede encadenar solo. */
const SINGLE_OUTPUT: ReadonlySet<string> = new Set([
  FlowNodeType.Trigger,
  FlowNodeType.Action,
  FlowNodeType.InvokeFlow,
  FlowNodeType.Wait,
])

const COLUMN = 380
const ROW = 260
/** Cuánto se tienen que acercar dos bloques para considerarse encimados. */
const NEAR_X = 300
const NEAR_Y = 180

export interface Placement {
  position: { x: number; y: number }
  /** La salida a la que nace conectado, si estaba libre. */
  from?: { source: string; handle: string }
}

/**
 * Dónde poner un bloque agregado con clic desde la barra lateral (2026-11-09).
 *
 * Antes la barra solo se podía arrastrar: sin mouse no había forma de
 * agregar un bloque, y arrastrando había que conectarlo después a mano. Ahora
 * va a la derecha del bloque elegido y, si este tiene una sola salida y está
 * libre, nace conectado a ella. Nunca le quita la conexión a otra salida: si
 * ya apuntaba a algo, el bloque nuevo queda suelto al lado. Sin bloque elegido,
 * va a la derecha del que esté más a la derecha.
 */
export function placeNewNode(nodes: readonly AutomationFlowNode[], edges: readonly AutomationFlowEdge[], selectedId: string | null): Placement {
  const selected = selectedId ? nodes.find(node => node.id === selectedId) : undefined
  const anchor = selected ?? rightmost(nodes)
  if (!anchor) return { position: { x: 0, y: 0 } }
  const position = freeSpot(nodes, { x: anchor.position.x + COLUMN, y: anchor.position.y })
  const outputFree = !edges.some(edge => edge.source === anchor.id && edge.source_handle === FlowHandle.Next)
  return selected && SINGLE_OUTPUT.has(selected.type) && outputFree
    ? { position, from: { source: selected.id, handle: FlowHandle.Next } }
    : { position }
}

function rightmost(nodes: readonly AutomationFlowNode[]): AutomationFlowNode | undefined {
  return nodes.reduce<AutomationFlowNode | undefined>((best, node) => (!best || node.position.x > best.position.x ? node : best), undefined)
}

/** Baja de a una fila hasta que no haya otro bloque encima. */
function freeSpot(nodes: readonly AutomationFlowNode[], start: { x: number; y: number }): { x: number; y: number } {
  let y = start.y
  for (let tries = 0; tries < 50; tries += 1) {
    const taken = nodes.some(node => Math.abs(node.position.x - start.x) < NEAR_X && Math.abs(node.position.y - y) < NEAR_Y)
    if (!taken) break
    y += ROW
  }
  return { x: start.x, y }
}
