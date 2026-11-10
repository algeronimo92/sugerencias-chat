import { AutomationActionType, FlowNodeType } from './automationCatalog'
import type { AutomationAction, AutomationConditions, AutomationFlowDefinition } from '../types'

/**
 * Dónde nombra una regla a un servicio del catálogo. Sigue la misma regla que
 * el backend (`sets_service` y `filters_by_service`): el nombre exacto, sin
 * distinguir mayúsculas, en la acción "Cambiar/quitar servicio de interés" (que
 * impide eliminar el servicio) o en la condición "Servicio de interés contiene"
 * (que solo se avisa). Si no coinciden, Catálogos diría "lo usa esta
 * automatización" y al abrirla no habría nada resaltado.
 */
function sameService(value: string | null | undefined, name: string): boolean {
  return typeof value === 'string' && value.toLowerCase() === name.toLowerCase()
}

export function conditionsNameService(conditions: AutomationConditions | null | undefined, name: string): boolean {
  return sameService(conditions?.service_contains, name)
}

export function actionNamesService(action: AutomationAction, name: string): boolean {
  return action.type === AutomationActionType.ChangeService && sameService(action.service, name)
}

export interface FlowServiceReferences {
  entryConditions: boolean
  nodeIds: string[]
}

export function flowServiceReferences(flow: AutomationFlowDefinition | null | undefined, name: string): FlowServiceReferences {
  if (!flow) return { entryConditions: false, nodeIds: [] }
  return {
    entryConditions: conditionsNameService(flow.conditions, name),
    nodeIds: flow.nodes
      .filter(node => node.type === FlowNodeType.Action && actionNamesService(node.data.action, name))
      .map(node => node.id),
  }
}

/** Qué se marca: la acción que asigna el servicio (impide eliminarlo) o la
 *  condición que filtra por su nombre (solo se avisa). */
export type ServiceReferencePart = 'action' | 'condition'

export function onlyPart(references: FlowServiceReferences, part: ServiceReferencePart): FlowServiceReferences {
  return part === 'action' ? { entryConditions: false, nodeIds: references.nodeIds } : { entryConditions: references.entryConditions, nodeIds: [] }
}

export function hasServiceReferences(references: FlowServiceReferences): boolean {
  return references.entryConditions || references.nodeIds.length > 0
}

const CHANGE_SERVICE = '"Cambiar/quitar servicio de interés"'

function places(conditions: string | false, count: number, one: string, many: string): string {
  const where = [conditions, count === 1 ? `${one} ${CHANGE_SERVICE}` : count > 1 && `${count} ${many} ${CHANGE_SERVICE}`]
  return where.filter(Boolean).join(' y ')
}

/** Lo que va en el aviso de la regla: dónde está, en palabras; vacío si ya no lo usa. */
export function ruleServiceSummary(inConditions: boolean, actions: number): string {
  return places(inConditions && 'las condiciones ("Servicio de interés contiene")', actions, 'la acción', 'acciones')
}

/** Igual, para un flujo visual. */
export function flowServiceSummary(references: FlowServiceReferences): string {
  return places(references.entryConditions && 'las condiciones de entrada ("Servicio de interés contiene")', references.nodeIds.length, 'el bloque', 'bloques')
}
