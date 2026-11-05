import { describe, expect, it } from 'vitest'

import type { CustomFieldDefinition } from '../../catalogs/types'
import { leadCorrections, leadUpdatesFor, prefillFromLead, type LeadSnapshot } from './leadPrefill'

function field(key: string, entity: 'lead' | 'appointment' = 'appointment'): CustomFieldDefinition {
  return { id: key.length, entity_type: entity, key, label: key.toUpperCase(), field_type: 'text', required: false, options: [], position: 0, is_active: true }
}

const LEAD: LeadSnapshot = {
  id: 'lead-1', name: 'Ana', phone: '51987654321', servicio_interes: 'Limpieza',
  vendedor: 'Luis', customFields: { dni: '40404040', alergias: '' },
}
const SELLERS = [{ name: 'Luis' }, { name: 'Marta' }]

describe('prellenado desde el lead', () => {
  it('toma los datos del lead y marca los que vinieron de él', () => {
    const prefill = prefillFromLead(LEAD, [field('dni'), field('alergias'), field('sede')], SELLERS, 'Marta')

    expect(prefill.form).toEqual({ nombreCompleto: 'Ana', telefono: '51987654321', servicio: 'Limpieza', vendedor: 'Luis' })
    expect(prefill.customFields).toEqual({ dni: '40404040' })
    expect([...prefill.prefilled].sort()).toEqual(['custom:dni', 'nombreCompleto', 'servicio', 'telefono', 'vendedor'])
  })

  it('sin vendedor activo en el lead, el responsable es quien agenda', () => {
    expect(prefillFromLead({ ...LEAD, vendedor: 'Ex empleado' }, [], SELLERS, 'Marta').form.vendedor).toBe('Marta')
    expect(prefillFromLead({ ...LEAD, vendedor: null }, [], SELLERS, null).form.vendedor).toBe('')
  })

  it('lo que el lead no tiene queda vacío y sin marca', () => {
    const prefill = prefillFromLead({ ...LEAD, name: null, servicio_interes: null }, [], SELLERS, null)

    expect(prefill.form.nombreCompleto).toBe('')
    expect(prefill.prefilled.has('nombreCompleto')).toBe(false)
  })
})

describe('correcciones para el lead', () => {
  const leadFields = [field('dni', 'lead'), field('alergias', 'lead')]

  it('detecta lo cambiado y lo completado, no lo vaciado ni lo igual', () => {
    const corrections = leadCorrections(
      LEAD,
      { nombreCompleto: ' Ana Pérez ', servicio: '' },
      { dni: '40404040', alergias: 'Penicilina', sede: 'Centro' },
      leadFields,
    )

    expect(corrections.map(c => [c.key, c.to])).toEqual([['nombre', 'Ana Pérez'], ['custom:alergias', 'Penicilina']])
  })

  it('arma el cuerpo de la API solo con lo elegido', () => {
    const corrections = leadCorrections(LEAD, { nombreCompleto: 'Ana Pérez', servicio: 'Botox' }, { alergias: 'No' }, leadFields)

    expect(leadUpdatesFor(corrections, new Set(['servicio_interes', 'custom:alergias']))).toEqual({
      servicio_interes: 'Botox', custom_fields: { alergias: 'No' },
    })
    expect(leadUpdatesFor(corrections, new Set())).toBeNull()
  })
})
