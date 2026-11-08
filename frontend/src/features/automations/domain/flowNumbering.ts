import { FlowNodeType } from './automationCatalog'
import type { AutomationFlowDefinition } from '../types'

/**
 * Número de cada bloque, en el orden en que se recorre el flujo desde el
 * disparador (#1): los que siguen a un bloque llevan números cercanos al suyo.
 * Los sueltos, sin camino desde el disparador, van al final.
 *
 * Con decenas de bloques, el lienzo alejado no dejaba leer cuál era cuál: el
 * aviso de Catálogos marcaba "el bloque" y había que buscarlo a ojo. Con el
 * número se lo nombra ("#12"), se lo ve en el lienzo y en sus conexiones.
 */
export function numberFlowNodes(flow: Pick<AutomationFlowDefinition, 'nodes' | 'edges'>): Map<string, number> {
  const reachable = reachableFromTrigger(flow)
  const order = [...reachable, ...flow.nodes.filter(node => !reachable.has(node.id)).map(node => node.id)]
  return new Map(order.map((id, index) => [id, index + 1]))
}

/**
 * Los bloques a los que se llega desde el disparador, en el orden del
 * recorrido. Los demás nunca se ejecutan: el lienzo los marca, y el servidor
 * no deja publicar con ellos (`validate_graph_topology`, mismo recorrido).
 */
export function reachableFromTrigger(flow: Pick<AutomationFlowDefinition, 'nodes' | 'edges'>): Set<string> {
  const next = new Map<string, string[]>()
  for (const edge of flow.edges) next.set(edge.source, [...(next.get(edge.source) ?? []), edge.target])
  const known = new Set(flow.nodes.map(node => node.id))
  const seen = new Set<string>()
  const queue = flow.nodes.filter(node => node.type === FlowNodeType.Trigger).map(node => node.id)
  while (queue.length) {
    const id = queue.shift() as string
    if (seen.has(id) || !known.has(id)) continue
    seen.add(id)
    queue.push(...(next.get(id) ?? []))
  }
  return seen
}
