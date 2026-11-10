import { toast } from 'sonner'

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
  try {
    await navigator.clipboard.writeText(sectionUrl(anchor))
    toast.success(`Enlace a «${title}» copiado`, { description: 'Quien lo abra llega a esta sección, con el mismo período y la misma persona.' })
  } catch {
    toast.error('No se pudo copiar el enlace', { description: 'Cópialo desde la barra de direcciones y agrega al final #' + anchor })
  }
}
