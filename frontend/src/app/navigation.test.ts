import { describe, expect, it } from 'vitest'

import { canSeeDashboard, homePathFor, MOBILE_TAB_PATHS, roleLabel, visibleNavItems } from './navigation'

const ADMIN = { role: 'admin' as const }
const SELLER = { role: 'vendedor' as const }
const ANALYST = { role: 'analista' as const }

describe('navegación por permisos', () => {
  it('el vendedor ve las vistas de operación y ninguna de administración', () => {
    const labels = visibleNavItems(SELLER).map((item) => item.label)
    expect(labels).toContain('Chats')
    expect(labels).not.toContain('Automatizaciones')
  })

  it('el dashboard lo leen solo quienes dirigen: el vendedor no lo tiene en el menú', () => {
    expect(visibleNavItems(SELLER).map((item) => item.label)).not.toContain('Dashboard')
    expect(visibleNavItems(ADMIN).map((item) => item.label)).toContain('Dashboard')
    expect(canSeeDashboard(SELLER)).toBe(false)
    // Mientras la sesión carga no hay usuario: no se muestra lo que quizá no le toca.
    expect(canSeeDashboard(undefined)).toBe(false)
    expect(visibleNavItems(undefined)).toEqual([])
  })

  it('el admin ve todo', () => {
    expect(visibleNavItems(ADMIN).map((item) => item.label)).toContain('Automatizaciones')
  })

  it('el analista ve el dashboard y los reportes, y entra por el dashboard', () => {
    expect(visibleNavItems(ANALYST).map((item) => item.path)).toEqual(['/dashboard', '/reports'])
    expect(homePathFor(ANALYST)).toBe('/dashboard')
    expect(homePathFor(SELLER)).toBe('/')
    expect(homePathFor(undefined)).toBe('/')
  })

  it('lo que el negocio le da a un rol aparece en su menú', () => {
    const seller = { role: 'vendedor' as const, permissions: ['conversations.view', 'catalogs.manage', 'dashboard.view'] }
    const labels = visibleNavItems(seller).map((item) => item.label)
    expect(labels).toEqual(expect.arrayContaining(['Chats', 'Catálogos', 'Dashboard']))
    expect(labels).not.toContain('Tareas')
  })

  it('sin chats ni dashboard, entra por los reportes', () => {
    expect(homePathFor({ role: 'analista', permissions: [] })).toBe('/reports')
  })

  it('la barra inferior del celular lleva Chats, Tareas y Contactos, y todo vendedor las ve', () => {
    const visible = visibleNavItems(SELLER).map((item) => item.path)
    const tabs = MOBILE_TAB_PATHS.map((path) => visibleNavItems(SELLER).find((item) => item.path === path)?.label)

    expect(tabs).toEqual(['Chats', 'Tareas', 'Contactos'])
    // Reportes y Embudo siguen accesibles desde "Más".
    expect(visible).toContain('/reports')
    expect(visible).toContain('/kanban')
  })

  it('cada rol tiene su nombre en la barra', () => {
    expect(roleLabel('admin')).toBe('Administrador')
    expect(roleLabel('vendedor')).toBe('Vendedor')
    expect(roleLabel('analista')).toBe('Analista')
  })
})
