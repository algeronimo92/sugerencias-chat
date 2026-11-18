import { useEffect, useRef, useState, type RefObject } from 'react'
import { useNodesInitialized, type FitViewOptions, type ReactFlowInstance } from '@xyflow/react'

/** Destello del bloque al que se acaba de ir (index.css). */
const PULSE_CLASS = 'flow-pulse'

/**
 * Acerca la vista a los bloques pedidos y los hace destellar. Con 50 bloques
 * el encuadre general los muestra a todos diminutos: llegar desde Catálogos
 * abría el panel del bloque marcado sin que se viera dónde estaba.
 *
 * Devuelve el encuadre inicial, que ya apunta a esos bloques: si el lienzo
 * encuadraba todo el flujo y después se acercaba, en producción (imágenes y
 * videos que tardan en medirse) el encuadre general llegaba último y ganaba.
 */
export function useFocusNodes(
  wrapper: RefObject<HTMLDivElement | null>,
  focus: { ids: string[]; key: number } | null,
  fitView: ReactFlowInstance['fitView'],
): FitViewOptions | undefined {
  const [initialFocus] = useState(focus)
  const nodesInitialized = useNodesInitialized()
  // Cada pedido de "ir a" (su `key`) se aplica una sola vez. Elegir un bloque
  // lo rearma y React Flow lo vuelve a medir: `nodesInitialized` pasa a false
  // y vuelve a true, y antes eso repetía el último acercamiento. Al hacer
  // clic en cualquier bloque la vista saltaba al último bloque al que se
  // había ido (el abierto desde el historial, el de la búsqueda o «Ver»).
  const appliedKey = useRef<number | null>(null)
  // El temporizador que apaga el destello vive fuera del efecto: si fuera su
  // limpieza, la siguiente vuelta del efecto (que ahora sale sin hacer nada)
  // lo cancelaría y el bloque quedaría destellando.
  const pulseTimer = useRef<number | null>(null)
  useEffect(() => () => { if (pulseTimer.current != null) window.clearTimeout(pulseTimer.current) }, [])

  useEffect(() => {
    if (!focus || !focus.ids.length || !nodesInitialized) return
    if (appliedKey.current === focus.key) return
    appliedKey.current = focus.key
    void fitView({ nodes: focus.ids.map(id => ({ id })), padding: 0.5, maxZoom: 1, duration: 450 })
    // Directo en el DOM y no por props, para no volver a dibujar el lienzo.
    const targets = focus.ids
      .map(id => wrapper.current?.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`))
      .filter((element): element is HTMLElement => element != null)
    for (const element of targets) {
      element.classList.remove(PULSE_CLASS)
      void element.offsetWidth // reinicia la animación si ya destellaba
      element.classList.add(PULSE_CLASS)
    }
    if (pulseTimer.current != null) window.clearTimeout(pulseTimer.current)
    pulseTimer.current = window.setTimeout(() => targets.forEach(element => element.classList.remove(PULSE_CLASS)), 2600)
  }, [focus, nodesInitialized, fitView, wrapper])

  return initialFocus?.ids.length ? { nodes: initialFocus.ids.map(id => ({ id })), padding: 0.5, maxZoom: 1 } : undefined
}
