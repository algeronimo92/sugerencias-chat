import { Check, Lock } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { Tooltip } from '../../../shared/ui/Tooltip'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useRoles, useUpdateRolePermissions } from '../hooks/useRoles'
import type { PermissionDef, RoleRow } from '../types'

/** Nombre de cada área del catálogo (`group` en backend/app/modules/auth/permissions.py). */
const PERMISSION_GROUP_LABELS: Record<string, string> = {
  dashboard: 'Dashboard',
  leads: 'Leads y embudo',
  conversations: 'Chats y llamadas',
  tasks: 'Tareas',
  appointments: 'Citas',
  contacts: 'Contactos',
  automations: 'Automatizaciones',
  catalogs: 'Plantillas y catálogos',
  settings: 'Configuración',
}

type Draft = Record<string, Set<string>>

function groupPermissions(permissions: PermissionDef[]) {
  const groups = new Map<string, PermissionDef[]>()
  for (const permission of permissions) {
    groups.set(permission.group, [...(groups.get(permission.group) ?? []), permission])
  }
  return [...groups.entries()].map(([group, items]) => ({ group, label: PERMISSION_GROUP_LABELS[group] ?? group, items }))
}

function sameSet(a: Set<string>, b: readonly string[]) {
  return a.size === b.length && b.every((item) => a.has(item))
}

function RoleHeader({ role }: { role: RoleRow }) {
  return (
    <th scope="col" className="w-24 px-2 py-2 text-center align-bottom font-semibold text-fg">
      <span className="block">{role.name}</span>
      <span className="block text-xs font-normal text-fg-muted tabular-nums">
        {role.active_users === 1 ? '1 persona' : `${role.active_users} personas`}
      </span>
    </th>
  )
}

/**
 * La matriz de permisos del negocio. Los roles son fijos: el administrador
 * tiene todo y su columna no se edita; las del vendedor y el analista sí. Lo
 * que se guarda también cambia los privilegios de la base de datos (ver la
 * sección "Privilegios en la base").
 */
export function RolesPanel() {
  const { data, isLoading, error } = useRoles()
  const { mutateAsync: save, isPending } = useUpdateRolePermissions()
  const [draft, setDraft] = useState<Draft>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  const roles = data?.roles ?? []
  const groups = useMemo(() => groupPermissions(data?.permissions ?? []), [data?.permissions])
  const current = (role: RoleRow) => draft[role.key] ?? new Set(role.permissions)
  const changed = roles.filter((role) => role.editable && draft[role.key] && !sameSet(draft[role.key], role.permissions))

  function toggle(role: RoleRow, permission: string, checked: boolean) {
    const next = new Set(current(role))
    if (checked) next.add(permission)
    else next.delete(permission)
    setDraft((previous) => ({ ...previous, [role.key]: next }))
    setSavedAt(null)
  }

  async function handleSave() {
    setSaveError(null)
    try {
      for (const role of changed) {
        // Uno por vez a propósito: cada guardado reaplica REVOKE/GRANT sobre las
        // mismas tablas del negocio, y dos a la vez chocan en PostgreSQL
        // ("tuple concurrently updated"). Son a lo sumo dos roles.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        await save({ role: role.key, permissions: [...draft[role.key]].sort() })
      }
      setDraft({})
      setSavedAt(Date.now())
    } catch (err) {
      setSaveError(extractErrorMessage(err))
    }
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full max-w-3xl space-y-4 px-4 py-6 md:px-8">
          <p className="text-sm text-fg-muted">
            Qué puede hacer cada rol en este negocio. El administrador tiene siempre todos los permisos. Lo que guardes
            se aplica en la app y también en la base de datos del negocio.
          </p>

          {isLoading && <p className="py-8 text-center text-sm text-fg-muted">Cargando roles…</p>}
          {error && <p role="alert" className="py-8 text-center text-sm text-danger-fg">No se pudieron cargar los roles.</p>}

          {groups.map((group) => (
            <section key={group.group} aria-labelledby={`permisos-${group.group}`} className="overflow-x-auto rounded-xl border border-line bg-surface">
              <table className="w-full min-w-[28rem] text-sm">
                <caption className="sr-only">Permisos de {group.label}</caption>
                <thead className="border-b border-line">
                  <tr>
                    <th scope="col" id={`permisos-${group.group}`} className="px-4 py-2 text-left align-bottom text-base font-semibold text-fg">
                      {group.label}
                    </th>
                    {roles.map((role) => <RoleHeader key={role.key} role={role} />)}
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((permission) => (
                    <tr key={permission.key} className="border-b border-line last:border-b-0">
                      <th scope="row" className="px-4 py-2.5 text-left font-normal text-fg">
                        <span className="flex items-center gap-1.5">
                          {permission.label}
                          {permission.admin_only && (
                            <Tooltip content="Solo el administrador: no se puede dar a otro rol">
                              <Lock className="h-3.5 w-3.5 shrink-0 text-fg-muted" strokeWidth={1.75} aria-label="Solo el administrador" />
                            </Tooltip>
                          )}
                        </span>
                      </th>
                      {roles.map((role) => {
                        const locked = !role.editable || permission.admin_only
                        const checked = role.editable ? current(role).has(permission.key) : true
                        return (
                          <td key={role.key} className="px-2 py-2.5 text-center">
                            <span className="inline-flex min-h-11 min-w-11 items-center justify-center">
                              <Checkbox
                                checked={checked}
                                disabled={locked || isPending}
                                aria-label={`${permission.label}: ${role.name}`}
                                onCheckedChange={(next) => toggle(role, permission.key, next)}
                              />
                            </span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ))}
        </div>
      </div>

      <div className="shrink-0 border-t border-line bg-surface py-3 pb-safe-3">
        <div className="flex w-full max-w-3xl items-center gap-3 px-4 md:px-8">
          <p className="flex-1 text-sm" role={saveError ? 'alert' : 'status'}>
            {saveError ? (
              <span className="text-danger-fg">{saveError}</span>
            ) : savedAt ? (
              <span className="flex items-center gap-1 text-accent-strong"><Check className="h-4 w-4" aria-hidden="true" /> Guardado</span>
            ) : changed.length > 0 ? (
              <span className="text-fg-muted">Cambios sin guardar en {changed.map((role) => role.name).join(' y ')}</span>
            ) : null}
          </p>
          <Button variant="secondary" onClick={() => { setDraft({}); setSaveError(null) }} disabled={changed.length === 0 || isPending}>
            Descartar
          </Button>
          <Button onClick={() => void handleSave()} disabled={changed.length === 0 || isPending} loading={isPending}>
            Guardar
          </Button>
        </div>
      </div>
    </>
  )
}
