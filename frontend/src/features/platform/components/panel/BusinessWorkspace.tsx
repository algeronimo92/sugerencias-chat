import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Activity, AlertTriangle, CheckCircle2, ChevronRight, ExternalLink, Loader2, SearchX } from 'lucide-react'
import { Button } from '../../../../shared/ui/Button'
import { ConfirmDialog } from '../../../../shared/ui/ConfirmDialog'
import { fetchOrganizations, setOrganizationStatus } from '../../api'
import { platformKeys } from '../../keys'
import type { Organization } from '../../types'
import { APARTADOS_NEGOCIO, apartadoDeNegocio } from './businessSections'
import { dominioPrincipal, urlDelCrm } from './businessStatus'
import { mensajeDeError } from './errors'
import { PanelLink } from './PanelLink'
import { RUTA_NEGOCIOS, rutaNegocio, usePanelNav } from './panelRoute'
import { AvisoError, EstadoNegocio, InicialNegocio } from './PanelUi'

function CambiarEstado({ organizacion }: { organizacion: Organization }) {
  const queryClient = useQueryClient()
  const suspendido = organizacion.status === 'suspended'
  const cambiar = useMutation({
    mutationFn: async () => {
      await setOrganizationStatus(organizacion, suspendido ? 'activate' : 'suspend')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: platformKeys.organizations }),
  })
  // Solo un negocio activo o suspendido tiene algo que alternar: mientras se
  // aprovisiona, o si su alta falló, el backend rechazaría el cambio.
  if (organizacion.status !== 'active' && !suspendido) return null

  const boton = (
    <button
      type="button"
      onClick={suspendido ? () => cambiar.mutate() : undefined}
      disabled={cambiar.isPending}
      className={`inline-flex h-10 items-center gap-1.5 rounded-lg border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary disabled:cursor-wait disabled:opacity-50 ${suspendido ? 'border-emerald-500/30 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300' : 'border-wa-border bg-white text-wa-muted hover:border-amber-500/30 hover:bg-amber-500/10 hover:text-amber-700 dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-muted-dark dark:hover:text-amber-300'}`}
    >
      {cambiar.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : suspendido ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Activity className="h-3.5 w-3.5" aria-hidden="true" />}
      {suspendido ? 'Reactivar' : 'Suspender'}
    </button>
  )

  return (
    <div className="flex flex-col items-end gap-1">
      {suspendido ? boton : (
        <ConfirmDialog
          title={`Suspender ${organizacion.name}`}
          description="Se cerrarán las sesiones activas y el negocio dejará de estar disponible hasta que lo reactives."
          confirmLabel="Suspender negocio"
          onConfirm={() => cambiar.mutate()}
          disabled={cambiar.isPending}
        >
          {boton}
        </ConfirmDialog>
      )}
      {cambiar.isError && <p role="alert" className="max-w-xs text-right text-xs font-medium text-red-600 dark:text-red-300">{mensajeDeError(cambiar.error)}</p>}
    </div>
  )
}

function Aviso({ tono, children }: { tono: 'aviso' | 'error'; children: string }) {
  return (
    <p className={`mt-4 flex items-start gap-2 rounded-lg border px-3.5 py-2.5 text-sm ${tono === 'aviso' ? 'border-amber-500/25 bg-amber-500/10 text-amber-800 dark:text-amber-200' : 'border-red-500/25 bg-red-500/10 text-red-700 dark:text-red-300'}`}>
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      {children}
    </p>
  )
}

/**
 * Espacio de un negocio: todo lo que el operador hace sobre un negocio pasa
 * acá adentro, con el negocio siempre a la vista en la cabecera. Antes cada
 * negocio era una tarjeta desplegable en una lista común, y era fácil guardar
 * la cuota o la marca en el negocio de al lado.
 */
export function BusinessWorkspace({ negocioId, apartado }: { negocioId: string; apartado: string | null }) {
  const { irA } = usePanelNav()
  const negocios = useQuery({ queryKey: platformKeys.organizations, queryFn: fetchOrganizations })
  const organizaciones = negocios.data?.items ?? []
  const organizacion = organizaciones.find((item) => item.id === negocioId)

  if (negocios.isLoading) {
    return (
      <div role="status" className="space-y-3">
        <div className="h-24 animate-pulse rounded-xl bg-wa-field motion-reduce:animate-none dark:bg-wa-head-dark" />
        <div className="h-64 animate-pulse rounded-xl bg-wa-field motion-reduce:animate-none dark:bg-wa-head-dark" />
        <span className="sr-only">Cargando negocio…</span>
      </div>
    )
  }
  if (negocios.isError) {
    return (
      <div className="space-y-3">
        <AvisoError mensaje={mensajeDeError(negocios.error)} />
        <Button variant="secondary" onClick={() => negocios.refetch()}>Volver a intentar</Button>
      </div>
    )
  }
  if (!organizacion) {
    return (
      <div className="flex flex-col items-center rounded-xl border border-dashed border-wa-border bg-white px-6 py-12 text-center dark:border-wa-border-dark dark:bg-wa-panel-dark">
        <SearchX className="h-10 w-10 text-wa-muted/50 dark:text-wa-muted-dark/50" strokeWidth={1.25} aria-hidden="true" />
        <h1 className="mt-4 text-base font-bold text-wa-text dark:text-white">Negocio no encontrado</h1>
        <p className="mt-1 max-w-sm text-sm text-wa-muted dark:text-wa-muted-dark">El enlace apunta a un negocio que ya no existe en la plataforma.</p>
        <PanelLink to={RUTA_NEGOCIOS} className="mt-4 inline-flex h-10 items-center rounded-lg border border-wa-border px-4 text-sm font-semibold text-wa-text hover:bg-wa-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary dark:border-wa-border-dark dark:text-wa-text-dark dark:hover:bg-wa-hover-dark">
          Volver a negocios
        </PanelLink>
      </div>
    )
  }

  const actual = apartadoDeNegocio(apartado)
  const principal = dominioPrincipal(organizacion)
  const Contenido = actual.Component

  return (
    <>
      <nav aria-label="Ruta" className="flex flex-wrap items-center gap-1.5 text-sm text-wa-muted dark:text-wa-muted-dark">
        <PanelLink to={RUTA_NEGOCIOS} className="rounded font-semibold hover:text-wa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary dark:hover:text-wa-text-dark">
          Negocios
        </PanelLink>
        <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
        <span className="min-w-0 truncate font-semibold text-wa-text dark:text-wa-text-dark">{organizacion.name}</span>
      </nav>

      <header className="mt-4 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <InicialNegocio nombre={organizacion.name} className="h-14 w-14 rounded-xl text-xl" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <h1 className="min-w-0 break-words text-2xl font-bold tracking-[-0.03em] text-wa-text sm:text-3xl dark:text-white">{organizacion.name}</h1>
              <EstadoNegocio status={organizacion.status} />
            </div>
            {principal && (
              <a
                href={urlDelCrm(principal)}
                target="_blank"
                rel="noreferrer"
                className="mt-1.5 inline-flex min-h-8 max-w-full items-center gap-1.5 rounded text-sm font-medium text-wa-muted hover:text-wa-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary dark:text-wa-muted-dark dark:hover:text-wa-primary"
              >
                <span className="break-all">{principal}</span>
                <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="sr-only">(abre el CRM del negocio en otra pestaña)</span>
              </a>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-start gap-2 lg:justify-end">
          {organizaciones.length > 1 && (
            <select
              aria-label="Cambiar de negocio"
              value={organizacion.id}
              onChange={(evento) => irA(rutaNegocio(evento.target.value, apartado))}
              className="h-10 max-w-56 rounded-lg border border-wa-border bg-white px-3 text-sm font-semibold text-wa-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-text-dark"
            >
              {organizaciones.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select>
          )}
          <CambiarEstado key={organizacion.id} organizacion={organizacion} />
        </div>
      </header>

      {organizacion.status === 'suspended' && (
        <Aviso tono="aviso">Este negocio está suspendido: nadie de su equipo puede entrar. Puedes dejarlo configurado antes de reactivarlo.</Aviso>
      )}
      {!organizacion.up_to_date && (
        <Aviso tono="error">Su esquema no está en la revisión que espera la plataforma. Revisa el apartado Sistema antes de reactivarlo o cambiar su configuración.</Aviso>
      )}

      <nav aria-label={`Apartados de ${organizacion.name}`} className="mt-6 border-b border-wa-border dark:border-wa-border-dark">
        <ul className="-mb-px flex gap-1 overflow-x-auto">
          {APARTADOS_NEGOCIO.map(({ id, label, icon: Icon }) => {
            const elegido = id === actual.id
            return (
              <li key={id} className="shrink-0">
                <PanelLink
                  to={rutaNegocio(organizacion.id, id)}
                  aria-current={elegido ? 'page' : undefined}
                  className={`inline-flex min-h-11 items-center gap-2 border-b-2 px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wa-primary ${elegido ? 'border-wa-primary text-wa-primary-strong dark:text-wa-primary' : 'border-transparent text-wa-muted hover:text-wa-text dark:text-wa-muted-dark dark:hover:text-wa-text-dark'}`}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {label}
                </PanelLink>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* La clave incluye el negocio: al cambiar de negocio el apartado se
          monta de cero y ningún formulario arrastra valores del anterior. */}
      <section key={`${organizacion.id}:${actual.id}`} aria-label={actual.label} className="mt-6">
        <h2 className="sr-only">{actual.label}</h2>
        <Contenido organizacion={organizacion} />
      </section>
    </>
  )
}
