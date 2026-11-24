import { useState } from 'react'
import { useCan } from '../../../shared/permissions'
import { Modal } from '../../../shared/ui/Modal'
import { describeBusinessHours, isOpenAt } from '../businessHours'
import { useBusinessHours } from '../hooks/useSettings'
import { BusinessHoursCard } from './BusinessHoursCard'

/**
 * El horario de atención vigente, a la vista en el lugar donde una
 * automatización lo usa, con el cambio a un clic.
 *
 * El editor decía «Está en horario laboral» sin decir cuál: había que saber
 * que se configura en otra pantalla, y un negocio con el horario por defecto
 * (lunes a viernes) perdía sus sábados sin que nada lo avisara.
 */
export function BusinessHoursHint() {
  const can = useCan()
  const canManage = can('settings.manage')
  // Leer el horario pide el permiso de Configuración: sin él no se consulta.
  const { data } = useBusinessHours(canManage)
  const [editing, setEditing] = useState(false)

  if (!canManage) {
    return <p className="text-[11px] leading-4 text-fg-muted">El horario de atención lo define un administrador en Configuración.</p>
  }
  if (!data) return null
  const openNow = isOpenAt(data.days, data.timezone, new Date())

  return (
    <div className="space-y-1 rounded-lg bg-subtle px-2.5 py-2 text-[11px] leading-4 text-fg-muted">
      <p>
        <span className="font-semibold text-fg">{describeBusinessHours(data.days)}</span>
        {openNow !== null && <> · ahora {openNow ? 'dentro' : 'fuera'} del horario</>}
      </p>
      {!data.configured && <p className="text-warning-fg">Es el horario por defecto. ¿Es el de tu negocio?</p>}
      <button type="button" onClick={() => setEditing(true)} className="font-semibold text-accent-strong underline outline-none focus-visible:ring-2 focus-visible:ring-ring">
        Cambiar horario
      </button>
      {editing && (
        // Encima del editor de flujos, que ocupa toda la pantalla: cambiar el
        // horario no debe costar lo que se estaba armando.
        <Modal title="Horario de atención" size="lg" layer="overFullscreen" onClose={() => setEditing(false)}>
          <BusinessHoursCard embedded />
        </Modal>
      )}
    </div>
  )
}
