import { useCallback } from 'react'

import { useMe } from './auth'
import type { AuthUser } from './types'

/**
 * Los permisos que el backend conoce (backend/app/modules/auth/permissions.py).
 * La app muestra u oculta pantallas y botones con esto; el backend igual los
 * exige en cada ruta, así que un permiso que falte acá solo esconde algo que
 * se podría usar, nunca abre algo prohibido.
 */
export const PERMISSIONS = [
  'dashboard.view', 'dashboard.view_member', 'dashboard.export', 'dashboard.export_personal_data',
  'leads.view', 'leads.view_all', 'leads.edit', 'leads.assign', 'leads.merge', 'leads.delete',
  'conversations.view', 'conversations.send', 'calls.handle', 'team.supervise',
  'tasks.use',
  'appointments.view', 'appointments.edit', 'appointments.manage', 'appointments.configure',
  'contacts.view', 'contacts.edit', 'contacts.delete', 'contacts.import',
  'automations.run', 'automations.manage',
  'templates.use', 'templates.manage', 'catalogs.manage', 'media_library.manage',
  'ai.configure', 'issue_reports.manage',
  'settings.manage', 'users.manage',
] as const

export type Permission = (typeof PERMISSIONS)[number]

/** Lo que trae cada rol si la sesión no dice sus permisos (una respuesta
 * vieja de /me o un doble de test): lo mismo que siembra la migración. */
const DEFAULT_PERMISSIONS: Record<string, readonly Permission[]> = {
  vendedor: [
    'leads.view', 'leads.view_all', 'leads.edit', 'conversations.view', 'conversations.send', 'calls.handle',
    'tasks.use', 'appointments.view', 'appointments.edit', 'contacts.view', 'contacts.edit',
    'automations.run', 'templates.use',
  ],
  analista: ['dashboard.view', 'dashboard.export'],
}

type Who = Pick<AuthUser, 'role'> & { permissions?: readonly string[] | null }

/** Quién mira: el usuario de la sesión, o nada mientras carga. */
export type Viewer = Who | null | undefined

/** Si `user` tiene alguno de `permissions`. El admin tiene todos. */
export function can(user: Viewer, ...permissions: Permission[]): boolean {
  if (!user) return false
  if (user.role === 'admin') return true
  const granted = new Set<string>(user.permissions ?? DEFAULT_PERMISSIONS[user.role] ?? [])
  return permissions.some((permission) => granted.has(permission))
}

/** `can` con el usuario de la sesión: `const allowed = useCan(); allowed('leads.delete')`. */
export function useCan(): (...permissions: Permission[]) => boolean {
  const { data: me } = useMe()
  return useCallback((...permissions: Permission[]) => can(me, ...permissions), [me])
}
