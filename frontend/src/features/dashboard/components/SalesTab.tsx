import type { DashboardMetrics } from '../types'
import type { DashboardSubject } from './subject'
import { SeparationsView } from './SeparationsView'

interface Props {
  data: DashboardMetrics
  days: number
  subject: DashboardSubject
  onOpenChat: (leadId: string) => void
}

/** La venta del negocio es la separación de cita con su adelanto. Antes la
 *  pestaña mostraba además las compras registradas ("Registrar compra"), que
 *  se quitaron: el negocio no cierra ventas con paquete en el CRM. */
export function SalesTab(props: Props) {
  return <SeparationsView {...props} />
}
