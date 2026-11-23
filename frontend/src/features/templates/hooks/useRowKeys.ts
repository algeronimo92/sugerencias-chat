import { useState } from 'react'

let sequence = 0
function newKey(): string {
  sequence += 1
  return `row-${sequence}`
}

/**
 * Claves estables para filas editables que no tienen un id propio (los
 * botones de una plantilla, las opciones de una lista).
 *
 * Con el índice como clave, al quitar una fila del medio React reutilizaba
 * los campos de la siguiente: el foco y la selección quedaban en la fila
 * equivocada. El texto que escribe el usuario tampoco sirve de clave, porque
 * cambia con cada tecla y el campo perdería el foco.
 *
 * Quien quita una fila llama a `removeAt` junto con su propio cambio; las
 * filas que se agregan al final reciben clave solas.
 */
export function useRowKeys(length: number) {
  const [keys, setKeys] = useState<string[]>(() => Array.from({ length }, newKey))
  let current = keys
  // El largo cambió sin pasar por `removeAt` (fila nueva, o el formulario
  // volvió a su estado inicial): se ajusta por el final.
  if (keys.length !== length) {
    current = keys.length > length ? keys.slice(0, length) : [...keys, ...Array.from({ length: length - keys.length }, newKey)]
    setKeys(current)
  }
  return {
    keys: current,
    removeAt: (index: number) => setKeys(list => list.filter((_, position) => position !== index)),
  }
}
