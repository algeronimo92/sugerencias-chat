import { MessagesSquare } from 'lucide-react'
import { useBrand } from '../branding'

interface Props {
  /** Clases de tamaño del contenedor, p. ej. "h-9 w-9". */
  sizeClass: string
  iconClass: string
}

/**
 * Logo del negocio; sin logo, el ícono genérico sobre su color principal.
 * El logo va sobre fondo blanco para que uno con transparencias se lea igual
 * en tema oscuro.
 */
export function BrandLogo({ sizeClass, iconClass }: Props) {
  const brand = useBrand()
  if (brand.logo_url) {
    return (
      <span className={`flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white ring-1 ring-wa-border dark:ring-wa-border-dark ${sizeClass}`}>
        <img src={brand.logo_url} alt="" className="h-full w-full object-contain" />
      </span>
    )
  }
  return (
    <span className={`flex shrink-0 items-center justify-center rounded-xl bg-wa-primary text-white shadow-sm ${sizeClass}`}>
      <MessagesSquare className={iconClass} strokeWidth={2.2} aria-hidden="true" />
    </span>
  )
}
