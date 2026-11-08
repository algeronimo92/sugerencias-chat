/**
 * Lo que el asistente IA sabe del negocio.
 *
 * Acá el negocio carga su perfil, sus documentos de conocimiento (generales
 * o de un servicio) y qué archivos de su biblioteca puede proponer el
 * asistente como adjuntos. Los precios viven en Catálogos > Servicios; las
 * claves y modelos de IA propios, en Integraciones.
 */
import { BookText, Building2, FolderOpen, Loader2, Sparkles } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { Input, Textarea, labelClass } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useAiProfile, useAiUsage, useSaveAiProfile } from '../queries'
import type { AIProfile } from '../types'
import { AiResourcesPanel } from './AiResourcesPanel'
import { KnowledgePanel } from './KnowledgePanel'
import { panelClass, tabClass } from './styles'

type Tab = 'profile' | 'knowledge' | 'resources'

const TABS: readonly { key: Tab; label: string; icon: typeof Sparkles }[] = [
  { key: 'profile', label: 'Perfil del negocio', icon: Building2 },
  { key: 'knowledge', label: 'Conocimiento', icon: BookText },
  { key: 'resources', label: 'Adjuntos', icon: FolderOpen },
]

// Mismos topes que valida el backend (services/ai_assistant_service.py).
const PROFILE_FIELDS: readonly {
  key: keyof Omit<AIProfile, 'updated_at'>
  label: string
  hint?: string
  placeholder: string
  maxLength: number
  multiline?: boolean
}[] = [
  { key: 'business_name', label: 'Nombre del negocio', placeholder: 'Clínica Norte', maxLength: 120 },
  { key: 'currency', label: 'Moneda de los precios', hint: 'Código de 3 letras', placeholder: 'PEN', maxLength: 10 },
  { key: 'business_description', label: 'Qué ofrece el negocio', placeholder: 'Clínica dermoestética con tratamientos faciales y corporales…', maxLength: 2000, multiline: true },
  { key: 'location', label: 'Ubicación', placeholder: 'Av. Principal 123, Miraflores. Estacionamiento gratuito.', maxLength: 500, multiline: true },
  { key: 'opening_hours', label: 'Horarios de atención', placeholder: 'Lunes a sábado de 9:00 a 19:00', maxLength: 500, multiline: true },
  { key: 'tone', label: 'Tono de los mensajes', placeholder: 'Cercano y profesional, tuteando al cliente', maxLength: 300 },
  { key: 'always_rules', label: 'El asistente siempre debe…', hint: 'Una regla por línea', placeholder: 'Ofrecer la evaluación gratuita\nPreguntar el nombre si no lo tenemos', maxLength: 2000, multiline: true },
  { key: 'never_rules', label: 'El asistente nunca debe…', hint: 'Una regla por línea', placeholder: 'Dar diagnósticos\nPrometer resultados', maxLength: 2000, multiline: true },
]

const EMPTY_PROFILE: Omit<AIProfile, 'updated_at'> = {
  business_name: null,
  business_description: null,
  location: null,
  opening_hours: null,
  currency: null,
  tone: null,
  always_rules: null,
  never_rules: null,
}

function UsageBanner() {
  const { data } = useAiUsage()
  if (!data) return null
  if (!data.enabled) {
    return (
      <p role="status" className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-3 text-sm text-amber-800 dark:text-amber-200">
        El asistente IA no está incluido en el plan de tu negocio. Puedes dejar todo preparado; las sugerencias se activarán cuando la plataforma lo habilite.
      </p>
    )
  }
  if (data.monthly_quota === null) {
    return <p className="mt-4 text-sm text-wa-muted dark:text-wa-muted-dark">{data.used_this_month} sugerencias generadas este mes · sin límite mensual.</p>
  }
  const percent = data.monthly_quota > 0 ? Math.min(100, Math.round((data.used_this_month / data.monthly_quota) * 100)) : 100
  return (
    <div className="mt-4 max-w-md">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-wa-text dark:text-wa-text-dark">{data.used_this_month} de {data.monthly_quota} sugerencias este mes</span>
        <span className="text-xs text-wa-muted dark:text-wa-muted-dark">Quedan {data.remaining}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-wa-field dark:bg-wa-field-dark" role="progressbar" aria-valuenow={data.used_this_month} aria-valuemin={0} aria-valuemax={data.monthly_quota} aria-label="Uso mensual del asistente">
        <div className={`h-full rounded-full ${percent >= 90 ? 'bg-amber-500' : 'bg-wa-primary'}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

function ProfilePanel() {
  const formId = useId()
  const { data, isLoading, error } = useAiProfile()
  const save = useSaveAiProfile()
  const [draft, setDraft] = useState<Omit<AIProfile, 'updated_at'>>(EMPTY_PROFILE)

  useEffect(() => {
    if (!data) return
    const { updated_at: _updatedAt, ...values } = data
    setDraft(values)
  }, [data])

  if (isLoading) return <p className="text-sm text-wa-muted dark:text-wa-muted-dark">Cargando perfil…</p>
  if (error) return <p role="alert" className="text-sm text-red-600 dark:text-red-300">{extractErrorMessage(error)}</p>

  return (
    <form
      className={panelClass}
      onSubmit={event => {
        event.preventDefault()
        save.mutate(draft, {
          onSuccess: () => toast.success('Perfil guardado'),
          onError: err => toast.error(extractErrorMessage(err)),
        })
      }}
    >
      <p className="text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
        El asistente usa estos datos para presentar tu negocio y redactar las sugerencias con tu estilo. Deja vacío lo que no aplique: nunca inventa lo que falta.
      </p>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {PROFILE_FIELDS.map(field => {
          const inputId = `${formId}-${field.key}`
          const value = draft[field.key] ?? ''
          const common = {
            id: inputId,
            value,
            maxLength: field.maxLength,
            placeholder: field.placeholder,
            onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
              setDraft(current => ({ ...current, [field.key]: event.target.value })),
          }
          return (
            <div key={field.key} className={field.multiline ? 'md:col-span-2' : undefined}>
              <label htmlFor={inputId} className={labelClass}>
                {field.label}
                {field.hint && <span className="font-normal"> · {field.hint}</span>}
              </label>
              {field.multiline ? <Textarea rows={3} {...common} /> : <Input {...common} />}
            </div>
          )
        })}
      </div>
      <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-wa-muted dark:text-wa-muted-dark">
          Los precios se cargan en <Link to="/catalogs" className="font-semibold text-wa-primary-strong hover:underline dark:text-wa-primary">Catálogos › Servicios</Link>.
        </p>
        <Button type="submit" disabled={save.isPending}>
          {save.isPending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Guardar perfil
        </Button>
      </div>
    </form>
  )
}

export function AiAssistantPage() {
  // Desde Catálogos se llega con ?tab=knowledge&servicio=ID para ver o subir
  // las fichas de ese servicio.
  const [params] = useSearchParams()
  const requestedTab = params.get('tab')
  const [tab, setTab] = useState<Tab>(requestedTab === 'knowledge' || requestedTab === 'resources' ? requestedTab : 'profile')
  const serviceParam = Number(params.get('servicio'))
  const initialServiceId = Number.isInteger(serviceParam) && serviceParam > 0 ? serviceParam : null

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto bg-wa-app dark:bg-wa-app-dark">
      <main className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-wa-text dark:text-white">Asistente IA</h1>
          <p className="mt-1.5 max-w-prose text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
            Lo que el asistente sabe de tu negocio para sugerir respuestas a tu equipo.
          </p>
          <UsageBanner />
          <div
            role="group"
            aria-label="Secciones del asistente"
            className="mt-5 flex max-w-full items-center gap-1 overflow-x-auto rounded-lg border border-wa-border bg-white p-1 dark:border-wa-border-dark dark:bg-wa-panel-dark sm:w-fit"
          >
            {TABS.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" onClick={() => setTab(key)} aria-pressed={tab === key} className={tabClass(tab === key)}>
                <Icon className="h-4 w-4" aria-hidden="true" />
                {label}
              </button>
            ))}
          </div>
        </header>

        <section aria-label={TABS.find(item => item.key === tab)?.label} className="mt-5">
          {tab === 'profile' ? <ProfilePanel /> : tab === 'knowledge' ? <KnowledgePanel initialServiceId={initialServiceId} /> : <AiResourcesPanel />}
        </section>
      </main>
    </div>
  )
}
