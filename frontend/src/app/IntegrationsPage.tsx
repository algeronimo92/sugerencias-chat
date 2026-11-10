import { lazy, Suspense, useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { Skeleton } from '../shared/ui/Skeleton'
import {
  ElevenLabsIntegrationCard,
  ErpIntegrationCard,
  GoogleCalendarIntegrationCard,
  WhatsappIntegrationCard,
  useIntegrationStatuses,
} from '../features/platform/public/integrations'
import { AiIntegrationCard, useAiProviders } from '../features/ai/public/aiIntegration'

// El armador del evento de Calendar es de citas, una feature de capa
// superior a platform: se arma acá y la tarjeta lo recibe como prop.
const CalendarEventTemplateEditor = lazy(() =>
  import('../features/appointments/public/CalendarEventTemplateEditor').then(module => ({ default: module.CalendarEventTemplateEditor })),
)

/**
 * Conexiones con servicios externos, en orden fijo: WhatsApp (sin él no hay
 * CRM), el calendario (citas de todos los días), el ERP (lo que cotiza la
 * IA) y la voz (se configura una vez). El chip de cada tarjeta ya dice el
 * estado; reordenar por estado solo desorientaría.
 */
export function IntegrationsPage() {
  const { hash } = useLocation()
  const platformStatuses = useIntegrationStatuses()
  // El asistente IA es de una feature de capa superior a platform: su estado
  // se suma acá, en la composición.
  const ai = useAiProviders()
  const aiConnected = Boolean(ai.data?.ready)
  const statuses = {
    loading: platformStatuses.loading || ai.isLoading,
    count: platformStatuses.count + (aiConnected ? 1 : 0),
    total: platformStatuses.total + 1,
  }

  // Entrar con ancla (#whatsapp desde la bandeja o el onboarding): el foco
  // aterriza en el título de esa tarjeta, para teclado y lector de pantalla.
  useEffect(() => {
    if (!hash) return
    const id = `${hash.slice(1)}-title`
    const timer = window.setTimeout(() => {
      const heading = document.getElementById(id)
      heading?.scrollIntoView({ block: 'start' })
      heading?.focus()
    }, 50)
    return () => window.clearTimeout(timer)
  }, [hash, statuses.loading])

  const summary = statuses.loading
    ? 'Comprobando conexiones…'
    : statuses.count === 0
      ? 'Ninguna conectada todavía. Empieza por WhatsApp.'
      : `${statuses.count} de ${statuses.total} conectadas`

  return (
    <div className="h-full overflow-x-hidden overflow-y-auto bg-wa-app dark:bg-wa-app-dark">
      <main className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight text-wa-text dark:text-white">Integraciones</h1>
          <p className="mt-1.5 max-w-prose text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
            Conecta WhatsApp, tu calendario, la lista de precios, las sugerencias con IA y la voz de los audios.
          </p>
          <p aria-live="polite" className="mt-1 text-sm text-wa-muted dark:text-wa-muted-dark">{summary}</p>
        </header>

        {statuses.loading ? (
          <div className="mt-5 space-y-4" aria-busy="true" aria-label="Cargando integraciones">
            {[0, 1, 2, 3, 4].map(index => (
              <div key={index} className="flex items-start gap-3 rounded-xl border border-wa-border bg-white p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark sm:p-5">
                <Skeleton className="h-10 w-10 rounded-lg" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-80 max-w-full" />
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 space-y-4">
            <WhatsappIntegrationCard highlight={statuses.count === 0} />
            <GoogleCalendarIntegrationCard
              eventEditor={(
                <Suspense fallback={null}>
                  <CalendarEventTemplateEditor />
                </Suspense>
              )}
            />
            <ErpIntegrationCard />
            <AiIntegrationCard />
            <ElevenLabsIntegrationCard />
          </div>
        )}
      </main>
    </div>
  )
}
