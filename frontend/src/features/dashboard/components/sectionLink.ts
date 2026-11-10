import { toast } from 'sonner'
import { copyText } from '../../../shared/utils/clipboard'

/** Id en pantalla de una sección del dashboard; el enlace la nombra en el
 *  fragmento de la dirección (`#separaciones-por-dia`). */
export const sectionElementId = (anchor: string) => `seccion-${anchor}`

/** El enlace de una sección: la vista actual (pestaña, período, a quién se
 *  mira) más el fragmento que lleva a la sección al abrirlo. */
export function sectionUrl(anchor: string): string {
  const { origin, pathname, search } = window.location
  return `${origin}${pathname}${search}#${anchor}`
}

export async function copySectionLink(anchor: string, title: string) {
  const url = sectionUrl(anchor)
  if (await copyText(url)) {
    toast.success(`Enlace a «${title}» copiado`, { description: 'Quien lo abra llega a esta sección, con el mismo período y la misma persona.' })
    return
  }
  // Pedir que lo armen a mano desde la barra de direcciones era poco práctico:
  // se muestra el enlace entero para seleccionarlo y copiarlo.
  toast.error('No se pudo copiar el enlace', { description: url, duration: 15000 })
}
