import { Check, Database, KeyRound, Plug, SlidersHorizontal, Users, type LucideIcon } from 'lucide-react'
import { useMemo } from 'react'
import { Link, NavLink, Navigate, useParams } from 'react-router-dom'
import { useCan, type Permission } from '../../../shared/permissions'
import { Button } from '../../../shared/ui/Button'
import { useSettings } from '../hooks/useSettings'
import { groupSettings, useSettingsDraft } from '../settingsDraft'
import { SettingField } from './SettingField'
import { DbPrivilegesPanel } from './DbPrivilegesPanel'
import { RolesPanel } from './RolesPanel'
import { UsersPanel } from './UsersPanel'

export type SettingsSection = 'general' | 'usuarios' | 'roles' | 'base'

// Usuarios, permisos y privilegios van juntos: quien gestiona personas decide
// qué puede hacer cada rol (`users.manage`, solo del admin).
const SECTIONS: { key: SettingsSection; label: string; path: string; icon: LucideIcon; permission: Permission }[] = [
  { key: 'general', label: 'General', path: '/configuracion', icon: SlidersHorizontal, permission: 'settings.manage' },
  { key: 'usuarios', label: 'Usuarios', path: '/configuracion/usuarios', icon: Users, permission: 'users.manage' },
  { key: 'roles', label: 'Roles y permisos', path: '/configuracion/roles', icon: KeyRound, permission: 'users.manage' },
  { key: 'base', label: 'Privilegios en la base', path: '/configuracion/base', icon: Database, permission: 'users.manage' },
]

// Las conexiones con terceros viven en la página de Integraciones, cada una
// con su propio "Guardar": acá no se muestran ni se reenvían, donde un
// "Guardar" con el borrador viejo pisaría lo que la otra pantalla acaba de
// conectar (el calendario elegido, las claves que dejó el Embedded Signup).
const INTEGRATION_GROUPS = new Set(['calendar', 'meta', 'elevenlabs', 'erp', 'whatsapp', 'ai'])

// Igual que los ítems del panel de bandejas y de etapas (FilterItem): 40 px,
// icono y el elegido en la pastilla gris.
const SECTION_LINK = ({ isActive }: { isActive: boolean }) =>
  `flex h-10 shrink-0 items-center gap-3 rounded-lg px-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
    isActive ? 'bg-selected font-semibold text-fg' : 'text-fg hover:bg-subtle'
  }`

function GeneralSettings() {
  const { data: allSettings, isLoading, error } = useSettings(true)
  const data = useMemo(() => allSettings?.filter((item) => !INTEGRATION_GROUPS.has(item.group)), [allSettings])
  const form = useSettingsDraft(data)
  const { handleSave, isSaving, saveError, savedAt, clearingSecretKey } = form
  const groups = data ? groupSettings(data) : []

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="w-full max-w-3xl space-y-4 px-4 py-6 md:px-8">
          <p className="flex items-center gap-1.5 text-sm text-fg-muted">
            <Plug className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>
              WhatsApp, Google Calendar, ERP, IA, voz y correo están en{' '}
              <Link to="/integraciones" className="font-semibold text-accent-strong underline">Integraciones</Link>.
            </span>
          </p>

          {isLoading && <p className="py-8 text-center text-sm text-fg-muted">Cargando configuración…</p>}
          {error && <p role="alert" className="py-8 text-center text-sm text-danger-fg">Error al cargar la configuración.</p>}

          {groups.map((g) => (
            <section key={g.group} aria-labelledby={`ajustes-${g.group}`} className="rounded-xl border border-line bg-surface p-4">
              <h2 id={`ajustes-${g.group}`} className="mb-3 text-sm font-semibold text-fg">{g.groupLabel}</h2>
              <div className="space-y-2.5">
                {g.items.map((item) => <SettingField key={item.key} item={item} form={form} />)}
              </div>
            </section>
          ))}
        </div>
      </div>

      {/* Al pie y fijo: los ajustes son muchos y "Guardar" tiene que estar a
          mano sin bajar hasta el final, como en el diálogo de antes. */}
      <div className="shrink-0 border-t border-line bg-surface py-3 pb-safe-3">
        {/* Mismo ancho y relleno que la columna de ajustes: "Guardar" queda
            alineado con el borde derecho de las tarjetas. */}
        <div className="flex w-full max-w-3xl items-center gap-3 px-4 md:px-8">
          <p className="flex-1 text-sm" role={saveError ? 'alert' : 'status'}>
            {saveError ? (
              <span className="text-danger-fg">{saveError}</span>
            ) : savedAt ? (
              <span className="flex items-center gap-1 text-accent-strong"><Check className="h-4 w-4" aria-hidden="true" /> Guardado</span>
            ) : null}
          </p>
          <Button onClick={() => handleSave()} disabled={isSaving || isLoading} loading={isSaving && clearingSecretKey === null}>
            Guardar
          </Button>
        </div>
      </div>
    </>
  )
}

/**
 * Configuración del CRM como página propia (antes un diálogo): una sección
 * por URL (/configuracion, /configuracion/usuarios, /configuracion/roles,
 * /configuracion/base), así recargar o volver
 * atrás deja a la persona donde estaba y se puede enlazar a una sección.
 *
 * Las secciones van en una columna a la izquierda, como las bandejas de la
 * lista de chats y las etapas del embudo; en el celular esa columna pasa a
 * ser una fila arriba que se desliza de costado.
 */
export function SettingsPage() {
  const { section: param } = useParams<{ section?: string }>()
  const allowed = useCan()
  const sections = SECTIONS.filter((item) => allowed(item.permission))
  const requested = SECTIONS.find((item) => item.key === (param ?? 'general'))
  // Una sección que no existe o que el rol no puede ver lleva a la primera que sí.
  if (!requested || !sections.includes(requested)) {
    const fallback = sections[0]
    if (fallback && fallback.key !== requested?.key) return <Navigate to={fallback.path} replace />
  }
  const section: SettingsSection = requested && sections.includes(requested) ? requested.key : 'general'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas md:flex-row">
      <aside className="flex shrink-0 flex-col border-b border-line bg-surface px-2 pt-4 md:w-60 md:border-b-0 md:border-r md:py-4 lg:w-64">
        <div className="px-3 pb-3">
          <h1 className="text-xl font-semibold text-fg">Configuración</h1>
          <p className="mt-1 hidden text-sm text-fg-muted md:block">Ajustes del CRM, personas que lo usan y qué puede hacer cada rol.</p>
        </div>
        <nav aria-label="Secciones de configuración" className="flex gap-1 overflow-x-auto pb-2 md:flex-col md:gap-0.5 md:overflow-visible md:pb-0">
          {sections.map(({ key, label, path, icon: Icon }) => (
            <NavLink key={key} to={path} end className={SECTION_LINK}>
              <Icon className="h-4 w-4 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden="true" />
              {label}
            </NavLink>
          ))}
        </nav>
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {section === 'general' ? (
          <GeneralSettings />
        ) : section === 'roles' ? (
          <RolesPanel />
        ) : section === 'base' ? (
          <DbPrivilegesPanel />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="w-full max-w-3xl px-4 py-6 md:px-8">
              <UsersPanel />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
