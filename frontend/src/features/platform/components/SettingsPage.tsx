import { Check, Plug } from 'lucide-react'
import { useMemo } from 'react'
import { Link, NavLink, useParams } from 'react-router-dom'
import { Button } from '../../../shared/ui/Button'
import { PageHeader } from '../../../shared/ui/PageHeader'
import { useSettings } from '../hooks/useSettings'
import { groupSettings, useSettingsDraft } from '../settingsDraft'
import { SettingField } from './SettingField'
import { UsersPanel } from './UsersPanel'

export type SettingsSection = 'general' | 'usuarios'

const SECTIONS: { key: SettingsSection; label: string; path: string }[] = [
  { key: 'general', label: 'General', path: '/configuracion' },
  { key: 'usuarios', label: 'Usuarios', path: '/configuracion/usuarios' },
]

// Las conexiones con terceros viven en la página de Integraciones, cada una
// con su propio "Guardar": acá no se muestran ni se reenvían, donde un
// "Guardar" con el borrador viejo pisaría lo que la otra pantalla acaba de
// conectar (el calendario elegido, las claves que dejó el Embedded Signup).
const INTEGRATION_GROUPS = new Set(['calendar', 'meta', 'elevenlabs', 'erp', 'whatsapp', 'ai'])

const SECTION_LINK = ({ isActive }: { isActive: boolean }) =>
  `rounded-lg px-3 py-1.5 text-sm font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${
    isActive ? 'bg-selected text-fg' : 'text-fg-muted hover:bg-subtle hover:text-fg'
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
 * por URL (/configuracion, /configuracion/usuarios), así recargar o volver
 * atrás deja a la persona donde estaba y se puede enlazar a una sección.
 */
export function SettingsPage() {
  const { section: param } = useParams<{ section?: string }>()
  const section: SettingsSection = param === 'usuarios' ? 'usuarios' : 'general'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-canvas">
      <PageHeader
        title="Configuración"
        description="Ajustes del CRM y personas que lo usan."
        toolbar={(
          <nav aria-label="Secciones de configuración" className="flex gap-1">
            {SECTIONS.map((item) => (
              <NavLink key={item.key} to={item.path} end className={SECTION_LINK}>{item.label}</NavLink>
            ))}
          </nav>
        )}
      />
      {section === 'general' ? (
        <GeneralSettings />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="w-full max-w-3xl px-4 py-6 md:px-8">
            <UsersPanel />
          </div>
        </div>
      )}
    </div>
  )
}
