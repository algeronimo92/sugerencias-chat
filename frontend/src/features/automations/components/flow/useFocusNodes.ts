import { useEffect, useState, type RefObject } from 'react'
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

  useEffect(() => {
    if (!focus || !focus.ids.length || !nodesInitialized) return
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
    const timer = window.setTimeout(() => targets.forEach(element => element.classList.remove(PULSE_CLASS)), 2600)
    return () => window.clearTimeout(timer)
  }, [focus, nodesInitialized, fitView, wrapper])

  return initialFocus?.ids.length ? { nodes: initialFocus.ids.map(id => ({ id })), padding: 0.5, maxZoom: 1 } : undefined
}
