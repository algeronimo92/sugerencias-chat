import type { AutomationFlowEdge } from '../types'

/**
 * Las conexiones de un bloque después de quitarle una salida numerada.
 *
 * Los botones de una Pregunta (`btn_1..n`) y las salidas de un Reparto por
 * turnos (`out_1..n`) llevan el número de su posición, y el backend los
 * reasigna igual al publicar. Al quitar una del medio, las siguientes bajan un
 * número: su conexión tiene que bajar con ellas.
 *
 * Antes solo se descartaba la conexión del último número. Con los botones
 * «Sí → agendar», «No → despedir», «Más tarde → recordar», borrar «No» dejaba
 * «Más tarde» conectado a «despedir»: el flujo seguía publicable y mandaba al
 * cliente por la ruta del botón borrado.
 *
 * Las salidas fijas del bloque (otra respuesta, sin respuesta…) no llevan el
 * prefijo y quedan como estaban.
 */
export function edgesAfterRemovingOutput(
  edges: readonly AutomationFlowEdge[],
  nodeId: string,
  prefix: string,
  removedIndex: number,
): AutomationFlowEdge[] {
  const result: AutomationFlowEdge[] = []
  for (const edge of edges) {
    const position = edge.source === nodeId ? positionOf(edge.source_handle, prefix) : null
    if (position === null || position < removedIndex) result.push(edge)
    else if (position > removedIndex) result.push({ ...edge, source_handle: `${prefix}${position}` })
    // position === removedIndex: la salida ya no existe, su conexión tampoco.
  }
  return result
}

/** Índice (desde 0) de una salida numerada, o null si el handle no es una. */
function positionOf(handle: string, prefix: string): number | null {
  if (!handle.startsWith(prefix)) return null
  const number = Number(handle.slice(prefix.length))
  return Number.isInteger(number) && number >= 1 ? number - 1 : null
}
