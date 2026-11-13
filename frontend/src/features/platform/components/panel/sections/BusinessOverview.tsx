import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { AlertTriangle, ArrowRight, CheckCircle2, Circle } from 'lucide-react'
import type { ReactNode } from 'react'
import { fetchOrganizationAi, fetchOrganizationOverview } from '../../../api'
import { platformKeys } from '../../../keys'
import type { OnboardingStepKey, Organization, ResumenNegocio } from '../../../types'
import { dominioPrincipal, etiquetaIA } from '../businessStatus'
import { mensajeDeError } from '../errors'
import { PanelLink } from '../PanelLink'
import { rutaNegocio } from '../panelRoute'
import { Tarjeta } from '../PanelUi'

// Mismos pasos que el checklist del CRM (OnboardingChecklist), dichos como
// hecho consumado: acá el operador mira el estado, no ejecuta el paso.
const PASOS: Record<OnboardingStepKey, string> = {
  whatsapp: 'WhatsApp conectado',
  team: 'Equipo invitado',
  services: 'Servicios con precio cargados',
  google_calendar: 'Google Calendar conectado',
  templates: 'Plantillas revisadas',
}

function Cifra({ valor, etiqueta }: { valor: ReactNode; etiqueta: string }) {
  return (
    <p>
      <span className="block text-2xl font-bold leading-none text-wa-text dark:text-white">{valor}</span>
      <span className="mt-1.5 block text-xs text-wa-muted dark:text-wa-muted-dark">{etiqueta}</span>
    </p>
  )
}

function IrA({ organizacion, apartado, children }: { organizacion: Organization; apartado: string; children: ReactNode }) {
  return (
    <PanelLink
      to={rutaNegocio(organizacion.id, apartado)}
      className="inline-flex min-h-9 items-center gap-1 rounded text-xs font-semibold text-wa-primary-strong hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary dark:text-wa-primary"
    >
      {children}
      <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
    </PanelLink>
  )
}

function PuestaEnMarcha({ resumen }: { resumen: UseQueryResult<ResumenNegocio> }) {
  const setup = resumen.data?.setup
  return (
    <Tarjeta
      titulo="Puesta en marcha"
      descripcion="Los primeros pasos del negocio, calculados de sus datos reales. Es lo mismo que ve su administrador."
      accion={setup && (
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${setup.all_done ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300'}`}>
          {setup.completed} de {setup.total}
        </span>
      )}
      className="lg:row-span-2"
    >
      {resumen.isLoading && <p role="status" className="text-xs text-wa-muted dark:text-wa-muted-dark">Cargando resumen…</p>}
      {resumen.isError && <p role="alert" className="text-xs text-red-600 dark:text-red-300">{mensajeDeError(resumen.error)}</p>}
      {setup && (
        <ul className="divide-y divide-wa-border dark:divide-wa-border-dark">
          {setup.steps.map((paso) => (
            <li key={paso.key} className="flex min-h-11 items-center gap-2.5 py-2 text-sm">
              {paso.done
                ? <CheckCircle2 className="h-4.5 w-4.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                : <Circle className="h-4.5 w-4.5 shrink-0 text-wa-muted/60 dark:text-wa-muted-dark/60" aria-hidden="true" />}
              <span className={paso.done ? 'text-wa-text dark:text-wa-text-dark' : 'text-wa-muted dark:text-wa-muted-dark'}>
                {PASOS[paso.key]}
                {paso.optional && <span className="ml-1.5 text-xs">(opcional)</span>}
              </span>
              <span className="ml-auto shrink-0 text-xs font-semibold text-wa-muted dark:text-wa-muted-dark">{paso.done ? 'Listo' : 'Pendiente'}</span>
            </li>
          ))}
        </ul>
      )}
    </Tarjeta>
  )
}

function EquipoYUso({ organizacion, resumen }: { organizacion: Organization; resumen: UseQueryResult<ResumenNegocio> }) {
  const asistente = useQuery({
    queryKey: platformKeys.ai(organizacion.id),
    queryFn: async () => await fetchOrganizationAi(organizacion),
  })
  return (
    <Tarjeta titulo="Equipo y uso">
      <div className="grid grid-cols-2 gap-4">
        <Cifra valor={resumen.data ? resumen.data.users : '—'} etiqueta={resumen.data?.users === 1 ? 'persona en el equipo' : 'personas en el equipo'} />
        <Cifra
          valor={asistente.data ? asistente.data.used_this_month : '—'}
          etiqueta={asistente.data?.monthly_quota != null ? `de ${asistente.data.monthly_quota} generaciones de IA este mes` : 'generaciones de IA este mes'}
        />
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-wa-border pt-3 dark:border-wa-border-dark">
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${organizacion.ai_enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-gray-500/10 text-gray-600 dark:text-gray-300'}`}>
          {etiquetaIA(organizacion)}
        </span>
        <IrA organizacion={organizacion} apartado="asistente">Configurar asistente</IrA>
      </div>
    </Tarjeta>
  )
}

function AccesoYSistema({ organizacion }: { organizacion: Organization }) {
  const principal = dominioPrincipal(organizacion)
  return (
    <Tarjeta titulo="Acceso y sistema">
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-xs font-semibold text-wa-muted dark:text-wa-muted-dark">Dominio principal</dt>
          <dd className="mt-0.5 break-all font-medium text-wa-text dark:text-wa-text-dark">{principal ?? 'Sin dominio'}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold text-wa-muted dark:text-wa-muted-dark">Esquema</dt>
          <dd className={`mt-0.5 inline-flex items-center gap-1.5 font-medium ${organizacion.up_to_date ? 'text-wa-text dark:text-wa-text-dark' : 'text-red-700 dark:text-red-300'}`}>
            {!organizacion.up_to_date && <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />}
            {organizacion.up_to_date ? 'Al día' : 'Pendiente de actualización'}
          </dd>
        </div>
      </dl>
      <div className="mt-3 flex flex-wrap gap-x-5 border-t border-wa-border pt-3 dark:border-wa-border-dark">
        <IrA organizacion={organizacion} apartado="dominios">
          {organizacion.domains.length === 1 ? '1 dominio' : `${organizacion.domains.length} dominios`}
        </IrA>
        <IrA organizacion={organizacion} apartado="sistema">Datos técnicos</IrA>
      </div>
    </Tarjeta>
  )
}

/** Primera pantalla del negocio: cómo está, sin tener que abrir cada apartado. */
export function BusinessOverview({ organizacion }: { organizacion: Organization }) {
  const resumen = useQuery({
    queryKey: platformKeys.overview(organizacion.id),
    queryFn: async () => await fetchOrganizationOverview(organizacion),
  })

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <PuestaEnMarcha resumen={resumen} />
      <EquipoYUso organizacion={organizacion} resumen={resumen} />
      <AccesoYSistema organizacion={organizacion} />
    </div>
  )
}
