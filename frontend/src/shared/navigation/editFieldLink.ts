/**
 * Enlace a una pantalla que abre su formulario con un campo resaltado:
 * `<ruta>?editar=<campo>&motivo=<texto>`. Lo usa quien manda a otra pantalla a
 * cambiar algo puntual, como Catálogos al lead que todavía usa el servicio que
 * se quiere eliminar: abrir solo el chat dejaba al usuario buscando qué tocar.
 *
 * La URL es el estado: la pantalla de destino abre el formulario mientras el
 * parámetro esté y lo quita al cerrarlo (`withoutEditField`).
 */
export const EDIT_FIELD_PARAM = 'editar'
export const EDIT_REASON_PARAM = 'motivo'

export interface EditFieldRequest {
  field: string
  reason: string | null
}

export function editFieldHref(path: string, field: string, reason?: string): string {
  const params = new URLSearchParams({ [EDIT_FIELD_PARAM]: field })
  if (reason) params.set(EDIT_REASON_PARAM, reason)
  return `${path}?${params.toString()}`
}

export function readEditField(params: URLSearchParams): EditFieldRequest | null {
  const field = params.get(EDIT_FIELD_PARAM)
  return field ? { field, reason: params.get(EDIT_REASON_PARAM) } : null
}

export function withoutEditField(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params)
  next.delete(EDIT_FIELD_PARAM)
  next.delete(EDIT_REASON_PARAM)
  return next
}
