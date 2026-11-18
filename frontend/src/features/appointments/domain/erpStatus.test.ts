import { describe, expect, it } from 'vitest'
import type { AppointmentListItem } from '../types'
import { erpStatusView } from './erpStatus'

const base = {
  id: 41, test_mode: false, dismissed_at: null, erp_sync_status: 'not_configured', erp_sync_error: null,
} as unknown as AppointmentListItem

describe('erpStatusView', () => {
  it('una cita enviada no se reenvía ni arrastra un error viejo', () => {
    expect(erpStatusView({ ...base, erp_sync_status: 'synced', erp_sync_error: 'viejo' }, true)).toEqual({
      label: 'En la agenda del ERP', sent: true, retryable: false, error: null,
    })
  })

  it('una cita que falló dice por qué y se puede reenviar', () => {
    expect(erpStatusView({ ...base, erp_sync_status: 'error', erp_sync_error: 'El ERP no respondió a tiempo' }, true)).toEqual({
      label: 'No llegó al ERP', sent: false, retryable: true, error: 'El ERP no respondió a tiempo',
    })
  })

  it('una cita anterior a la integración se puede enviar si ahora está activa', () => {
    expect(erpStatusView(base, true)).toMatchObject({ label: 'Sin enviar al ERP', retryable: true })
    expect(erpStatusView(base, false)).toBeNull()
  })

  it('el error se sigue viendo aunque ya no se pueda reenviar', () => {
    const failed = { ...base, erp_sync_status: 'error', erp_sync_error: 'caído' } as AppointmentListItem
    expect(erpStatusView(failed, false)).toMatchObject({ retryable: false, error: 'caído' })
    expect(erpStatusView({ ...failed, dismissed_at: '2026-11-14T15:00:00Z' }, true)).toMatchObject({ retryable: false })
  })

  it('una cita de prueba no muestra nada: nunca se envía', () => {
    expect(erpStatusView({ ...base, test_mode: true }, true)).toBeNull()
  })
})
