import { useStore, useStoreApi } from '@xyflow/react'
import { useEffect } from 'react'
import { numberScale } from '../../domain/flowTones'

/**
 * Le pasa al CSS cuánto agrandar el número (#n) de cada bloque según el zoom
 * (`--flow-number-scale`, ver index.css). Escribe la variable en el contenedor
 * del lienzo y no en cada bloque: alejar o acercar no vuelve a dibujar los 50
 * bloques, solo cambia una variable que el CSS ya usa.
 */
export function ZoomScale() {
  const scale = useStore(state => numberScale(state.transform[2]))
  const store = useStoreApi()
  useEffect(() => {
    store.getState().domNode?.style.setProperty('--flow-number-scale', String(scale))
  }, [scale, store])
  return null
}
