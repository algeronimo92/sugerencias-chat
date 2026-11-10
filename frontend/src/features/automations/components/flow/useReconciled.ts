import { useEffect, useMemo, useRef, type DependencyList } from 'react'

/**
 * Reutiliza entre renders los elementos que no cambiaron. `build` recibe lo
 * que se mostró la última vez (por id) y devuelve la lista nueva más su índice;
 * cuando un elemento es igual al anterior, devuelve el objeto anterior y React
 * no lo vuelve a dibujar. Con 50 bloques y 49 conexiones, crear objetos nuevos
 * en cada cambio redibujaba el lienzo entero (2026-11-08).
 *
 * El índice se guarda recién cuando el render se confirma, no durante: React
 * puede repetir o descartar un render, y escribir un ref en medio filtraría
 * trabajo que nunca se mostró. Si un render se descarta, la próxima pasada
 * compara contra lo último que sí se mostró, que es lo correcto.
 */
export function useReconciled<Item, Entry>(
  build: (previous: ReadonlyMap<string, Entry>) => { list: Item[]; index: Map<string, Entry> },
  deps: DependencyList,
): Item[] {
  const committed = useRef<ReadonlyMap<string, Entry>>(new Map())
  // Las dependencias son las de `build` y las declara quien llama, igual que
  // en useMemo; el lint no puede verificarlas desde acá.
  // oxlint-disable-next-line react-hooks/exhaustive-deps
  const result = useMemo(() => build(committed.current), deps)
  useEffect(() => {
    committed.current = result.index
  }, [result])
  return result.list
}
