/**
 * Enlace a una pantalla que abre su formulario con un campo resaltado:
 * `<ruta>?editar=<campo>&motivo=<texto>`. Lo usa quien manda a otra pantalla a
 * cambiar algo puntual, como Catálogos al lead que todavía usa el servicio que
 * se quiere eliminar: abrir solo el chat dejaba al usuario buscando qué tocar.
 *
 * Cuando la pantalla de destino es un listado (Automatizaciones), `registro`
 * dice cuál abrir y `valor` qué buscar en él (el nombre del servicio): con
 * solo la pantalla, el usuario no sabía qué regla ni qué parte cambiar.
 *
 * La URL es el estado: la pantalla de destino abre el formulario mientras el
 * parámetro esté y lo quita al cerrarlo (`withoutEditField`).
 */
export const EDIT_FIELD_PARAM = 'editar'
export const EDIT_REASON_PARAM = 'motivo'
export const EDIT_RECORD_PARAM = 'registro'
export const EDIT_VALUE_PARAM = 'valor'

export interface EditFieldRequest {
  field: string
  reason: string | null
  record: string | null
  value: string | null
}

export interface EditFieldTarget {
  record?: string | number
  value?: string
}

export function editFieldHref(path: string, field: string, reason?: string, target: EditFieldTarget = {}): string {
  const params = new URLSearchParams({ [EDIT_FIELD_PARAM]: field })
  if (reason) params.set(EDIT_REASON_PARAM, reason)
  if (target.record != null) params.set(EDIT_RECORD_PARAM, String(target.record))
  if (target.value) params.set(EDIT_VALUE_PARAM, target.value)
  return `${path}?${params.toString()}`
}

export function readEditField(params: URLSearchParams): EditFieldRequest | null {
  const field = params.get(EDIT_FIELD_PARAM)
  return field
    ? { field, reason: params.get(EDIT_REASON_PARAM), record: params.get(EDIT_RECORD_PARAM), value: params.get(EDIT_VALUE_PARAM) }
    : null
}

export function withoutEditField(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const name of [EDIT_FIELD_PARAM, EDIT_REASON_PARAM, EDIT_RECORD_PARAM, EDIT_VALUE_PARAM]) next.delete(name)
  return next
}
