import type { AnchorHTMLAttributes } from 'react'
import { hashDeRuta, usePanelNav, type RutaPanel } from './panelRoute'

type Props = { to: RutaPanel } & Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'href'>

/** Enlace interno del panel: un `<a>` real (se puede abrir en otra pestaña o
 *  copiar) que, con un clic normal, navega sin recargar. */
export function PanelLink({ to, onClick, ...rest }: Props) {
  const { irA } = usePanelNav()
  return (
    <a
      href={hashDeRuta(to)}
      onClick={(evento) => {
        onClick?.(evento)
        if (evento.defaultPrevented || evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) return
        evento.preventDefault()
        irA(to)
      }}
      {...rest}
    />
  )
}
