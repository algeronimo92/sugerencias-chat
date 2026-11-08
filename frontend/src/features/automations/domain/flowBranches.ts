import { FlowHandle, QUESTION_HANDLE_LABELS, WAIT_ANY_CONDITION_LABELS } from './automationCatalog'

/** Nombre visible de la salida por la que siguió un paso (`step.branch`), para
 *  el Historial, «Flujos enviados» y Probar. Antes se mostraba el código
 *  («timeout», «btn_1», «group-…»), que no le dice nada a quien lee.
 *
 *  Las salidas propias de cada bloque (`btn_N` de una Pregunta, `out_N` de un
 *  Reparto, `group-…` de una Condición) solo se pueden nombrar con el flujo a
 *  mano; sin él la función devuelve null y cada vista elige su frase. */
const BRANCH_NAMES: Record<string, string> = {
  [FlowHandle.Yes]: 'Sí',
  [FlowHandle.No]: 'Ninguna de las condiciones',
  ...WAIT_ANY_CONDITION_LABELS,
  ...QUESTION_HANDLE_LABELS,
}

export function flowBranchName(branch: string | null | undefined): string | null {
  if (!branch) return null
  return Object.hasOwn(BRANCH_NAMES, branch) ? BRANCH_NAMES[branch] : null
}


/** «siguió por «Sin respuesta»» en el detalle de un paso ya ejecutado. */
export function followedBranchText(branch: string): string {
  const name = flowBranchName(branch)
  return name ? `siguió por «${name}»` : 'siguió por una de sus salidas'
}
