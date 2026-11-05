import { CheckCircle2, ChevronDown, Circle, ListChecks, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { useDismissOnboarding, useOnboarding, type OnboardingStepKey } from '../hooks/useOnboarding'

/** Pestañas del diálogo de configuración a las que lleva un paso. */
export type OnboardingSettingsTab = 'whatsapp' | 'usuarios' | 'calendario'

type StepTarget = { settings: OnboardingSettingsTab } | { path: string }

interface StepMeta {
  title: string
  description: string
  action: string
  target: StepTarget
}

const STEPS: Record<OnboardingStepKey, StepMeta> = {
  whatsapp: {
    title: 'Conectar WhatsApp',
    description: 'Vincula el número del negocio para recibir y responder chats.',
    action: 'Conectar',
    target: { settings: 'whatsapp' },
  },
  team: {
    title: 'Invitar al equipo',
    description: 'Suma a tus asesoras para repartir las conversaciones.',
    action: 'Invitar',
    target: { settings: 'usuarios' },
  },
  services: {
    title: 'Cargar servicios y precios',
    description: 'El asistente IA cotiza con este catálogo.',
    action: 'Cargar',
    target: { path: '/catalogs' },
  },
  google_calendar: {
    title: 'Conectar Google Calendar',
    description: 'Las citas agendadas se sincronizan con tu calendario.',
    action: 'Conectar',
    target: { settings: 'calendario' },
  },
  templates: {
    title: 'Revisar plantillas',
    description: 'Ajusta los mensajes rápidos que se usan con / en el chat.',
    action: 'Revisar',
    target: { path: '/templates' },
  },
}

interface Props {
  /** Solo los admins la ven: el endpoint lo exige y los pasos son de configuración. */
  enabled: boolean
  /** Ruta actual: al volver de otra pantalla (catálogos, plantillas) se reconsulta. */
  pathname: string
  onOpenSettings: (tab: OnboardingSettingsTab) => void
  onNavigate: (path: string) => void
}

/** Barra de primeros pasos del negocio. Cada paso sale de los datos reales
 *  (GET /api/onboarding); se oculta cuando todo está hecho o el admin la
 *  descarta (vale para todo el negocio); OnboardingReopenButton la recupera. */
export function OnboardingChecklist({ enabled, pathname, onOpenSettings, onNavigate }: Props) {
  const { data, refetch } = useOnboarding(enabled)
  const { mutate: dismiss, isPending: dismissing } = useDismissOnboarding()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (enabled) void refetch()
  }, [enabled, pathname, refetch])

  if (!enabled || !data || data.dismissed || data.all_done) return null

  const percent = data.total ? Math.round((data.completed / data.total) * 100) : 0

  function go(target: StepTarget) {
    if ('settings' in target) onOpenSettings(target.settings)
    else onNavigate(target.path)
  }

  return (
    <section
      aria-label="Primeros pasos"
      className="shrink-0 border-b border-wa-border bg-white px-3 py-2 sm:px-5 dark:border-wa-border-dark dark:bg-wa-panel-dark"
    >
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-wa-primary/10 text-wa-primary-strong dark:bg-wa-primary/15 dark:text-wa-primary">
          <ListChecks className="h-4 w-4" aria-hidden />
        </span>
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
          aria-controls="onboarding-steps"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-wa-primary/60"
        >
          <span className="min-w-0">
            <span className="block truncate text-xs font-semibold text-wa-text dark:text-wa-text-dark">
              Primeros pasos
            </span>
            <span className="block text-[11px] text-wa-muted dark:text-wa-muted-dark">
              {data.completed} de {data.total} listos
            </span>
          </span>
          <span
            role="progressbar"
            aria-label="Avance de los primeros pasos"
            aria-valuemin={0}
            aria-valuemax={data.total}
            aria-valuenow={data.completed}
            className="hidden h-1.5 w-32 overflow-hidden rounded-full bg-wa-field sm:block dark:bg-wa-head-dark"
          >
            <span className="block h-full rounded-full bg-wa-primary transition-[width]" style={{ width: `${percent}%` }} />
          </span>
          <ChevronDown
            className={`ml-auto h-4 w-4 shrink-0 text-wa-muted transition-transform dark:text-wa-muted-dark ${open ? 'rotate-180' : ''}`}
            aria-hidden
          />
          <span className="sr-only">{open ? 'Ocultar pasos' : 'Ver pasos'}</span>
        </button>
        <button
          type="button"
          onClick={() => dismiss(undefined, {
            onSuccess: () => toast('Primeros pasos ocultos', {
              description: 'Puedes volver a verlos desde el ícono de lista en la barra superior.',
            }),
          })}
          disabled={dismissing}
          aria-label="Ocultar los primeros pasos"
          title="Ocultar"
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-wa-muted transition-colors hover:bg-wa-hover hover:text-wa-text disabled:opacity-50 dark:text-wa-muted-dark dark:hover:bg-wa-head-dark"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {open && (
        <ul id="onboarding-steps" className="mt-2 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
          {data.steps.map((step) => {
            const meta = STEPS[step.key]
            return (
              <li
                key={step.key}
                className="flex items-center gap-2.5 rounded-lg border border-wa-border px-2.5 py-2 dark:border-wa-border-dark"
              >
                {step.done ? (
                  <CheckCircle2 className="h-4 w-4 shrink-0 text-wa-primary" aria-label="Hecho" />
                ) : (
                  <Circle className="h-4 w-4 shrink-0 text-wa-muted dark:text-wa-muted-dark" aria-label="Pendiente" />
                )}
                <span className="min-w-0 flex-1">
                  <span
                    className={`block text-xs font-medium ${step.done ? 'text-wa-muted line-through dark:text-wa-muted-dark' : 'text-wa-text dark:text-wa-text-dark'}`}
                  >
                    {meta.title}
                    {step.optional && <span className="ml-1 font-normal text-wa-muted dark:text-wa-muted-dark">(opcional)</span>}
                  </span>
                  <span className="block text-[11px] leading-snug text-wa-muted dark:text-wa-muted-dark">
                    {meta.description}
                  </span>
                </span>
                {!step.done && (
                  <Button size="sm" variant="secondary" onClick={() => go(meta.target)} aria-label={`${meta.action}: ${meta.title}`}>
                    {meta.action}
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
