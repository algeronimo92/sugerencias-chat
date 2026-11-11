import { Globe2, LayoutDashboard, Palette, ServerCog, Sparkles, Workflow, type LucideIcon } from 'lucide-react'
import type { ComponentType } from 'react'
import type { Organization } from '../../types'
import { BusinessAssistant } from './sections/BusinessAssistant'
import { BusinessBranding } from './sections/BusinessBranding'
import { BusinessDomains } from './sections/BusinessDomains'
import { BusinessIntegrations } from './sections/BusinessIntegrations'
import { BusinessOverview } from './sections/BusinessOverview'
import { BusinessSystem } from './sections/BusinessSystem'

export interface ApartadoNegocio {
  /** Va en el enlace (`#negocios/<id>/<id del apartado>`): no renombrar a la ligera. */
  id: string
  label: string
  icon: LucideIcon
  /** Recibe el negocio abierto; cada apartado carga y guarda lo suyo. */
  Component: ComponentType<{ organizacion: Organization }>
}

/**
 * Apartados del espacio de un negocio, en el orden en que se muestran.
 *
 * Es el punto de extensión del panel: una capacidad nueva por negocio
 * (facturación, límites, usuarios, auditoría…) es una entrada acá y un
 * componente en `sections/`, sin tocar el directorio ni el resto de apartados.
 * El primero es el que se abre por defecto.
 */
export const APARTADOS_NEGOCIO: ApartadoNegocio[] = [
  { id: 'resumen', label: 'Resumen', icon: LayoutDashboard, Component: BusinessOverview },
  { id: 'dominios', label: 'Dominios', icon: Globe2, Component: BusinessDomains },
  { id: 'asistente', label: 'Asistente IA', icon: Sparkles, Component: BusinessAssistant },
  { id: 'integraciones', label: 'Integraciones propias', icon: Workflow, Component: BusinessIntegrations },
  { id: 'marca', label: 'Marca', icon: Palette, Component: BusinessBranding },
  { id: 'sistema', label: 'Sistema', icon: ServerCog, Component: BusinessSystem },
]

export function apartadoDeNegocio(id: string | null): ApartadoNegocio {
  return APARTADOS_NEGOCIO.find((apartado) => apartado.id === id) ?? APARTADOS_NEGOCIO[0]
}
