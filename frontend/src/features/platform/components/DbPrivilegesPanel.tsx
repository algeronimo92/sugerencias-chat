import { Check, ChevronRight, Database, Info, Minus, Search, ShieldCheck } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Input } from '../../../shared/ui/Input'
import { useDbPrivileges } from '../hooks/useRoles'
import type { DbRolePrivileges } from '../types'

const OBJECT_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const

const PRIVILEGE_LABELS: Record<(typeof OBJECT_PRIVILEGES)[number], string> = {
  SELECT: 'Leer',
  INSERT: 'Crear',
  UPDATE: 'Editar',
  DELETE: 'Borrar',
}

/** Atributos de sistema del rol: los que deberían estar en "No" lo están, y
 * lo único que tiene sobre el schema es poder usarlo. */
const SYSTEM_PRIVILEGES: { key: keyof DbRolePrivileges['system']; label: string; expected: boolean }[] = [
  { key: 'schema_usage', label: 'Usar el schema del negocio', expected: true },
  { key: 'schema_create', label: 'Crear, alterar o borrar tablas', expected: false },
  { key: 'login', label: 'Iniciar sesión en la base', expected: false },
  { key: 'superuser', label: 'Superusuario', expected: false },
  { key: 'create_role', label: 'Crear roles', expected: false },
  { key: 'create_db', label: 'Crear bases de datos', expected: false },
  { key: 'bypass_rls', label: 'Saltarse la seguridad por fila', expected: false },
]

/** `cv_<id>_vendedor` → `vendedor`: el id del negocio no le dice nada a nadie. */
function roleSuffix(dbRole: string) {
  return dbRole.slice(dbRole.lastIndexOf('_') + 1)
}

const ROLE_NAMES: Record<string, string> = { admin: 'Administrador', vendedor: 'Vendedor', analista: 'Analista' }

function YesNo({ value }: { value: boolean }) {
  return value ? (
    <span className="inline-flex items-center gap-1 text-fg"><Check className="h-4 w-4 text-accent-strong" aria-hidden="true" />Sí</span>
  ) : (
    <span className="inline-flex items-center gap-1 text-fg-muted"><Minus className="h-4 w-4" aria-hidden="true" />No</span>
  )
}

function RoleCard({ role, filter }: { role: DbRolePrivileges; filter: string }) {
  const name = ROLE_NAMES[roleSuffix(role.db_role)] ?? role.db_role
  const objects = role.objects.filter((item) => item.object.includes(filter))
  const writable = role.objects.filter((item) => item.privileges.some((privilege) => privilege !== 'SELECT')).length
  const systemOk = SYSTEM_PRIVILEGES.every(({ key, expected }) => role.system[key] === expected)

  return (
    <section aria-labelledby={`base-${role.db_role}`} className="rounded-xl border border-line bg-surface">
      <header className="border-b border-line px-4 py-3">
        <h2 id={`base-${role.db_role}`} className="text-base font-semibold text-fg">{name}</h2>
        <p className="mt-0.5 break-all font-mono text-xs text-fg-muted">{role.db_role}</p>
        <p className="mt-1 text-sm text-fg-muted tabular-nums">
          {role.objects.length} objetos con acceso · {writable} con escritura
        </p>
      </header>

      <div className="px-4 py-3">
        <h3 className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-fg">
          <ShieldCheck className="h-4 w-4 text-fg-muted" strokeWidth={1.75} aria-hidden="true" />
          Privilegios de sistema
        </h3>
        {!systemOk && (
          <p role="alert" className="mb-2 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-fg">
            Este rol tiene algún privilegio de sistema que no debería: revisarlo en la base.
          </p>
        )}
        <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {SYSTEM_PRIVILEGES.map(({ key, label }) => (
            <div key={key} className="flex items-center justify-between gap-3">
              <dt className="text-fg-muted">{label}</dt>
              <dd><YesNo value={role.system[key]} /></dd>
            </div>
          ))}
        </dl>
      </div>

      <details className="group border-t border-line">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm font-semibold text-fg outline-none hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronRight className="h-4 w-4 text-fg-muted transition-transform group-open:rotate-90" strokeWidth={1.75} aria-hidden="true" />
          Privilegios de objeto (tablas)
        </summary>
        <div className="overflow-x-auto px-4 pb-3">
          {objects.length === 0 ? (
            <p className="py-3 text-sm text-fg-muted">{filter ? 'Ninguna tabla coincide con la búsqueda.' : 'Sin acceso a ninguna tabla.'}</p>
          ) : (
            <table className="w-full min-w-[26rem] text-sm">
              <caption className="sr-only">Privilegios de objeto de {name}</caption>
              <thead>
                <tr className="border-b border-line text-fg-muted">
                  <th scope="col" className="py-2 pr-3 text-left font-semibold">Tabla</th>
                  {OBJECT_PRIVILEGES.map((privilege) => (
                    <th key={privilege} scope="col" className="w-16 px-1 py-2 text-center font-semibold" title={privilege}>
                      {PRIVILEGE_LABELS[privilege]}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {objects.map((item) => (
                  <tr key={item.object} className="border-b border-line last:border-b-0">
                    <th scope="row" className="py-1.5 pr-3 text-left font-mono text-xs font-normal text-fg">
                      {item.object}
                      {item.object.includes('.') && <span className="ml-1 font-sans text-fg-muted">(solo esa columna)</span>}
                    </th>
                    {OBJECT_PRIVILEGES.map((privilege) => (
                      <td key={privilege} className="px-1 py-1.5 text-center">
                        {item.privileges.includes(privilege) ? (
                          <Check className="mx-auto h-4 w-4 text-accent-strong" aria-label={PRIVILEGE_LABELS[privilege]} />
                        ) : (
                          <span className="sr-only">No</span>
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </details>
    </section>
  )
}

/**
 * Lo que PostgreSQL tiene aplicado hoy a los tres roles de base de este
 * negocio, leído de la base (pg_roles e information_schema), no de la matriz:
 * sirve para comprobar que lo que se marcó en "Roles y permisos" llegó a la
 * base. Solo lectura.
 */
export function DbPrivilegesPanel() {
  const { data, isLoading, error } = useDbPrivileges()
  const [filter, setFilter] = useState('')
  const roles = useMemo(
    () => [...(data?.roles ?? [])].sort((a, b) => ['admin', 'vendedor', 'analista'].indexOf(roleSuffix(a.db_role)) - ['admin', 'vendedor', 'analista'].indexOf(roleSuffix(b.db_role))),
    [data?.roles],
  )

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="w-full max-w-3xl space-y-4 px-4 py-6 md:px-8">
        <p className="flex items-start gap-1.5 text-sm text-fg-muted">
          <Database className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden="true" />
          <span>
            Cada negocio tiene sus propios roles en la base de datos, con acceso solo a sus tablas. Esto es lo que la base
            tiene aplicado hoy; se actualiza solo al guardar los permisos de un rol.
          </span>
        </p>

        {data && (
          <p className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm ${data.enforcement_active ? 'bg-success-soft text-success-fg' : 'bg-info-soft text-info-fg'}`}>
            {data.enforcement_active ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /> : <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />}
            {data.enforcement_active
              ? 'Activo: cada acción del equipo corre en la base con el rol de quien la hace.'
              : 'Los privilegios están aplicados, pero las acciones todavía corren con el usuario general de la base (DB_ROLE_ENFORCEMENT apagado).'}
          </p>
        )}

        {isLoading && <p className="py-8 text-center text-sm text-fg-muted">Consultando la base…</p>}
        {error && <p role="alert" className="py-8 text-center text-sm text-danger-fg">No se pudieron leer los privilegios de la base.</p>}
        {data && roles.length === 0 && (
          <p className="rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning-fg">
            Este negocio todavía no tiene roles en la base: se crean al correr las migraciones.
          </p>
        )}

        {roles.length > 0 && (
          <label className="relative block">
            <span className="sr-only">Buscar tabla</span>
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-fg-muted" aria-hidden="true" />
            <Input value={filter} onChange={(event) => setFilter(event.target.value.trim().toLowerCase())} placeholder="Buscar tabla" className="pl-9" />
          </label>
        )}

        {roles.map((role) => <RoleCard key={role.db_role} role={role} filter={filter} />)}
      </div>
    </div>
  )
}
