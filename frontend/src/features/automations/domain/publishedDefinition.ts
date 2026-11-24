import type { AutomationFlowDefinition } from '../types'

/**
 * La versión publicada de un flujo, o `null` si lo que llegó no es un flujo.
 *
 * El contrato la tipa como JSON abierto. Un objeto vacío (`{}`) o sin bloques
 * pasaba como «publicado» y el editor se caía al abrirlo con «Cannot read
 * properties of undefined (reading 'filter')»: toda la pantalla quedaba en el
 * aviso de error. Sin bloques no hay nada publicado que mostrar ni comparar.
 */
export function asPublishedDefinition(value: unknown): AutomationFlowDefinition | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Partial<AutomationFlowDefinition>
  if (!Array.isArray(candidate.nodes) || !Array.isArray(candidate.edges) || candidate.nodes.length === 0) return null
  return { ...candidate, conditions: candidate.conditions ?? {} } as AutomationFlowDefinition
}
