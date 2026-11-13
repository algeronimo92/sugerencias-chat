import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Link2, Loader2 } from 'lucide-react'
import { useId, useState, type ComponentType, type FormEvent } from 'react'
import { GoogleMark, MetaMark, MicrosoftMark, N8nMark, ZohoMark } from '../../../shared/ui/BrandMarks'
import { Button } from '../../../shared/ui/Button'
import { Input, labelClass } from '../../../shared/ui/Input'
import { IntegrationCard, type IntegrationState } from '../../../shared/ui/IntegrationCard'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { fetchPlatformSettings, savePlatformSettings } from '../api'
import { platformKeys } from '../keys'
import type { PlatformSetting } from '../types'
import { PlatformEmailPanel } from './PlatformEmailPanel'

interface AppInfo {
  group: string
  title: string
  description: string
  icon: ComponentType<{ className?: string }>
}

// Una tarjeta por app y las apps agrupadas por para qué sirven: antes era
// una sola lista de catorce campos donde no se distinguía qué iba con qué.
const SECTIONS: { title: string; apps: AppInfo[] }[] = [
  {
    title: 'WhatsApp',
    apps: [
      {
        group: 'meta',
        title: 'Meta · Tech Provider',
        description: 'La app de Facebook con la que cada negocio conecta su WhatsApp (Embedded Signup) y que recibe los webhooks. Las WABA y sus tokens quedan dentro de cada negocio.',
        icon: MetaMark,
      },
    ],
  },
  {
    title: 'Inteligencia artificial',
    apps: [
      {
        group: 'n8n',
        title: 'n8n · Analista IA',
        description: 'Un solo workflow para todos los negocios: cada job viaja firmado con su negocio, no en la URL.',
        icon: N8nMark,
      },
    ],
  },
  {
    title: 'Conexiones de los negocios',
    apps: [
      {
        group: 'google',
        title: 'Google',
        description: 'Cliente OAuth para "Conectar con Google": Calendar y el correo de Gmail.',
        icon: GoogleMark,
      },
      {
        group: 'microsoft',
        title: 'Microsoft',
        description: 'Cliente OAuth para conectar el correo de Outlook o Microsoft 365.',
        icon: MicrosoftMark,
      },
      {
        group: 'zoho',
        title: 'Zoho',
        description: 'Cliente OAuth para conectar el correo de Zoho Mail.',
        icon: ZohoMark,
      },
      {
        group: 'email_oauth',
        title: 'Vuelta de "Conectar correo"',
        description: 'Una sola URL de vuelta para Google, Microsoft y Zoho. Hay que registrarla en la app de cada uno.',
        icon: Link2,
      },
    ],
  },
]

function stateOf(items: PlatformSetting[]): { state: IntegrationState; label?: string } {
  const configured = items.filter((item) => item.configured).length
  if (configured === items.length) return { state: 'connected', label: 'Configurado' }
  if (configured === 0) return { state: 'unconfigured' }
  return { state: 'unconfigured', label: `Incompleto (${configured} de ${items.length})` }
}

function initialDraft(items: PlatformSetting[]): Record<string, string> {
  return Object.fromEntries(items.map((item) => [item.key, item.secret ? '' : (item.value ?? '')]))
}

function AppCredentialsCard({ app, items }: { app: AppInfo; items: PlatformSetting[] }) {
  const formId = useId()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState(() => initialDraft(items))
  const [saved, setSaved] = useState(false)

  const save = useMutation({
    mutationFn: () => {
      // Solo las claves de esta app; un secreto vacío conserva el guardado.
      const values: Record<string, string> = {}
      for (const item of items) {
        const value = draft[item.key] ?? ''
        if (!item.secret || value) values[item.key] = value
      }
      return savePlatformSettings(values)
    },
    onSuccess: (data) => {
      queryClient.setQueryData(platformKeys.settings, data)
      setDraft((previous) => {
        const next = { ...previous }
        for (const item of items) if (item.secret) next[item.key] = ''
        return next
      })
      setSaved(true)
    },
  })

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaved(false)
    save.mutate()
  }

  const { state, label } = stateOf(items)

  return (
    <IntegrationCard id={`plataforma-${app.group}`} icon={app.icon} title={app.title} state={state} stateLabel={label}>
      <form onSubmit={handleSubmit} className="space-y-3">
        {items.map((item) => {
          const inputId = `${formId}-${item.key}`
          return (
            <div key={item.key}>
              <label htmlFor={inputId} className={`${labelClass} flex flex-wrap items-center gap-2`}>
                {item.label}
                {item.source === 'environment' && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                    Desde entorno
                  </span>
                )}
              </label>
              <Input
                id={inputId}
                type={item.secret ? 'password' : 'text'}
                value={draft[item.key] ?? ''}
                onChange={(event) => {
                  setSaved(false)
                  setDraft((previous) => ({ ...previous, [item.key]: event.target.value }))
                }}
                autoComplete="off"
                placeholder={item.secret && item.configured ? '•••• sin cambios' : 'Sin configurar'}
              />
            </div>
          )
        })}
        {save.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{extractErrorMessage(save.error)}</p>}
        <div className="flex items-center justify-end gap-3">
          {saved && !save.isPending && (
            <span className="mr-auto inline-flex items-center gap-1 text-xs font-semibold text-wa-primary-strong dark:text-wa-primary">
              <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> Guardado
            </span>
          )}
          <Button type="submit" disabled={save.isPending} aria-label={`Guardar ${app.title}`}>
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            Guardar
          </Button>
        </div>
      </form>
    </IntegrationCard>
  )
}

function SectionLabel({ children }: { children: string }) {
  return <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">{children}</p>
}

/** Credenciales globales de la plataforma, una tarjeta por app. */
export function PlatformCredentials() {
  const query = useQuery({ queryKey: platformKeys.settings, queryFn: fetchPlatformSettings })

  return (
    <div className="space-y-8">
      {query.isLoading && <p className="text-sm text-wa-muted dark:text-wa-muted-dark">Cargando credenciales…</p>}
      {query.isError && <p role="alert" className="text-sm text-red-600 dark:text-red-300">{extractErrorMessage(query.error)}</p>}
      {query.data &&
        SECTIONS.map((section) => {
          const apps = section.apps
            .map((app) => ({ app, items: query.data.filter((item) => item.group === app.group) }))
            .filter(({ items }) => items.length > 0)
          if (apps.length === 0) return null
          return (
            <section key={section.title} aria-label={section.title}>
              <SectionLabel>{section.title}</SectionLabel>
              <div className="grid gap-4 lg:grid-cols-2">
                {apps.map(({ app, items }) => <AppCredentialsCard key={app.group} app={app} items={items} />)}
              </div>
            </section>
          )
        })}
      <section aria-label="Correo">
        <SectionLabel>Correo</SectionLabel>
        <PlatformEmailPanel />
      </section>
    </div>
  )
}
