import { describe, expect, it } from 'vitest'

import { homePathFor, roleLabel, visibleNavItems } from './navigation'

describe('navegación por rol', () => {
  it('el vendedor ve las vistas de operación y ninguna de administración', () => {
    const labels = visibleNavItems('vendedor').map((item) => item.label)
    expect(labels).toContain('Chats')
    expect(labels).toContain('Dashboard')
    expect(labels).not.toContain('Automatizaciones')
  })

  it('el admin ve todo', () => {
    expect(visibleNavItems('admin').map((item) => item.label)).toContain('Automatizaciones')
  })

  it('el analista solo ve el dashboard y entra por él', () => {
    expect(visibleNavItems('analista').map((item) => item.path)).toEqual(['/dashboard'])
    expect(homePathFor('analista')).toBe('/dashboard')
    expect(homePathFor('vendedor')).toBe('/')
    expect(homePathFor(undefined)).toBe('/')
  })

  it('cada rol tiene su nombre en la barra', () => {
    expect(roleLabel('admin')).toBe('Administrador')
    expect(roleLabel('vendedor')).toBe('Vendedor')
    expect(roleLabel('analista')).toBe('Analista')
  })
})
