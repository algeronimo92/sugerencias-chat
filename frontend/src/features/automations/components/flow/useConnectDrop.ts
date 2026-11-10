import { useCallback, useState } from 'react'
import type { OnConnectEnd, XYPosition } from '@xyflow/react'
import { FlowHandle } from '../../domain/automationCatalog'
import type { AutomationFlowNodeType } from '../../types'

interface ConnectDrop { x: number; y: number; source: string; handle: string }

/**
 * Soltar una conexión en un espacio vacío del lienzo abre el menú de bloques
 * (NodeTypeMenu) y el elegido nace conectado a esa salida. Solo en el vacío:
 * soltarla sobre un bloque, fuera de su punto de entrada, no es pedir uno nuevo.
 */
export function useConnectDrop(
  screenToFlowPosition: (point: XYPosition) => XYPosition,
  onDropNewNode: (type: AutomationFlowNodeType, position: XYPosition, from: { source: string; handle: string }) => void,
) {
  const [drop, setDrop] = useState<ConnectDrop | null>(null)

  const onConnectEnd = useCallback<OnConnectEnd>((event, connection) => {
    const fromHandle = connection.fromHandle
    if (connection.isValid || connection.toNode || !connection.fromNode || fromHandle?.type !== 'source') return
    const point = 'changedTouches' in event ? event.changedTouches[0] : event
    // `event.target` no sirve para saber dónde se soltó: es la línea que se
    // estaba dibujando, no lo que hay debajo.
    const below = document.elementFromPoint(point.clientX, point.clientY)
    if (!below?.closest('.react-flow__pane') || below.closest('.react-flow__node')) return
    setDrop({ x: point.clientX, y: point.clientY, source: connection.fromNode.id, handle: fromHandle.id || FlowHandle.Next })
  }, [])

  const close = useCallback(() => setDrop(null), [])

  const pick = useCallback((type: AutomationFlowNodeType) => {
    if (!drop) return
    const position = screenToFlowPosition({ x: drop.x, y: drop.y })
    // El punto de entrada del bloque queda donde se soltó la línea.
    onDropNewNode(type, { x: Math.round(position.x), y: Math.round(position.y - 30) }, { source: drop.source, handle: drop.handle })
    setDrop(null)
  }, [drop, screenToFlowPosition, onDropNewNode])

  return { drop, onConnectEnd, pick, close }
}
