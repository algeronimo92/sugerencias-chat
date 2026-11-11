import { useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Building2, ChevronRight, Search } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../../../shared/ui/Button'
import { Input } from '../../../../shared/ui/Input'
import { fetchOrganizations } from '../../api'
import { platformKeys } from '../../keys'
import type { Organization } from '../../types'
import { dominioPrincipal, etiquetaIA } from './businessStatus'
import { mensajeDeError } from './errors'
import { NewBusinessDialog } from './NewBusinessDialog'
import { PanelLink } from './PanelLink'
import { rutaNegocio } from './panelRoute'
import { AvisoError, EstadoNegocio, InicialNegocio } from './PanelUi'

const FILTROS = [
  { id: 'todos', label: 'Todos', incluye: () => true },
  { id: 'activos', label: 'Activos', incluye: (o: Organization) => o.status === 'active' },
  { id: 'suspendidos', label: 'Suspendidos', incluye: (o: Organization) => o.status === 'suspended' },
  { id: 'por-actualizar', label: 'Por actualizar', incluye: (o: Organization) => !o.up_to_date },
] as const
type Filtro = (typeof FILTROS)[number]['id']

function FilaNegocio({ organizacion }: { organizacion: Organization }) {
  const principal = dominioPrincipal(organizacion)
  const otros = organizacion.domains.length - 1
  return (
    <li className="relative flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5 transition hover:bg-wa-hover focus-within:bg-wa-hover sm:flex-nowrap sm:px-5 dark:hover:bg-wa-hover-dark dark:focus-within:bg-wa-hover-dark">
      <div className="flex min-w-0 flex-1 basis-full items-center gap-3.5 sm:basis-auto">
        <InicialNegocio nombre={organizacion.name} />
        <div className="min-w-0">
          {/* El enlace cubre toda la fila (after:inset-0) pero se anuncia solo
              con el nombre del negocio. */}
          <PanelLink
            to={rutaNegocio(organizacion.id)}
            className="block break-words text-[15px] font-bold text-wa-text after:absolute after:inset-0 focus-visible:outline-none focus-visible:after:rounded-lg focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-wa-primary dark:text-white"
          >
            {organizacion.name}
          </PanelLink>
          <p className="mt-0.5 break-all text-sm text-wa-muted dark:text-wa-muted-dark">
            {principal ?? 'Sin dominio'}
            {otros > 0 && ` · +${otros} ${otros === 1 ? 'dominio' : 'dominios'}`}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2 pl-[3.375rem] sm:pl-0">
        {!organizacion.up_to_date && (
          <span className="inline-flex items-center gap-1.5 rounded-md bg-red-500/10 px-2.5 py-1 text-xs font-semibold text-red-700 dark:text-red-300">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
            Pendiente de actualización
          </span>
        )}
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${organizacion.ai_enabled ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300' : 'bg-gray-500/10 text-gray-600 dark:text-gray-300'}`}>
          {etiquetaIA(organizacion)}
        </span>
        <EstadoNegocio status={organizacion.status} />
      </div>
      <ChevronRight className="ml-auto hidden h-4 w-4 shrink-0 text-wa-muted sm:block dark:text-wa-muted-dark" aria-hidden="true" />
    </li>
  )
}

/** Directorio de negocios: solo para encontrar uno y entrar a su espacio.
 *  Toda la administración de un negocio vive en BusinessWorkspace. */
export function BusinessDirectory() {
  const queryClient = useQueryClient()
  const [busqueda, setBusqueda] = useState('')
  const [filtro, setFiltro] = useState<Filtro>('todos')
  const refrescar = () => queryClient.invalidateQueries({ queryKey: platformKeys.organizations })
  const negocios = useQuery({ queryKey: platformKeys.organizations, queryFn: fetchOrganizations })

  const organizaciones = negocios.data?.items ?? []
  const texto = busqueda.trim().toLocaleLowerCase()
  const incluye = FILTROS.find((item) => item.id === filtro)?.incluye ?? (() => true)
  const visibles = organizaciones.filter((organizacion) =>
    incluye(organizacion) &&
    `${organizacion.name} ${organizacion.domains.map((dominio) => dominio.hostname).join(' ')}`.toLocaleLowerCase().includes(texto),
  )
  const filtrando = texto !== '' || filtro !== 'todos'

  return (
    <>
      <section className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-[-0.03em] text-wa-text dark:text-white">Negocios</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
            Elige un negocio para administrar su acceso, su asistente, sus integraciones y su marca.
          </p>
        </div>
        <NewBusinessDialog onCreado={refrescar} />
      </section>

      <section className="mt-6" aria-label="Lista de negocios">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-2">
            {FILTROS.map((item) => {
              const elegido = filtro === item.id
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={elegido}
                  onClick={() => setFiltro(item.id)}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary ${elegido ? 'border-wa-primary bg-wa-primary/10 text-wa-primary-strong dark:text-wa-primary' : 'border-wa-border bg-white text-wa-muted hover:text-wa-text dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-muted-dark dark:hover:text-wa-text-dark'}`}
                >
                  {item.label}
                  <span className="tabular-nums text-wa-text dark:text-white">{negocios.isLoading ? '—' : organizaciones.filter(item.incluye).length}</span>
                </button>
              )
            })}
          </div>
          {organizaciones.length > 0 && (
            <div className="relative w-full lg:w-72">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
              <Input aria-label="Buscar negocio o dominio" value={busqueda} onChange={(evento) => setBusqueda(evento.target.value)} placeholder="Buscar negocio o dominio" className="h-10 border-wa-border bg-white pl-9 dark:border-wa-border-dark dark:bg-wa-head-dark" />
            </div>
          )}
        </div>

        <p aria-live="polite" className="mt-4 text-sm text-wa-muted dark:text-wa-muted-dark">
          {negocios.isLoading
            ? 'Cargando lista…'
            : filtrando
              ? `${visibles.length} de ${organizaciones.length} negocios`
              : `${organizaciones.length} ${organizaciones.length === 1 ? 'negocio' : 'negocios'}`}
        </p>

        {negocios.isLoading && (
          <div role="status" className="mt-3 space-y-2">
            <div className="h-[4.5rem] animate-pulse rounded-xl bg-wa-field motion-reduce:animate-none dark:bg-wa-head-dark" />
            <div className="h-[4.5rem] animate-pulse rounded-xl bg-wa-field motion-reduce:animate-none dark:bg-wa-head-dark" />
            <span className="sr-only">Cargando negocios…</span>
          </div>
        )}
        {negocios.isError && (
          <div className="mt-4 space-y-3">
            <AvisoError mensaje={mensajeDeError(negocios.error)} />
            <Button variant="secondary" onClick={refrescar}>Volver a intentar</Button>
          </div>
        )}

        {visibles.length > 0 && (
          <ul className="mt-3 divide-y divide-wa-border overflow-hidden rounded-xl border border-wa-border bg-white dark:divide-wa-border-dark dark:border-wa-border-dark dark:bg-wa-panel-dark">
            {visibles.map((organizacion) => <FilaNegocio key={organizacion.id} organizacion={organizacion} />)}
          </ul>
        )}

        {!negocios.isLoading && !negocios.isError && organizaciones.length > 0 && visibles.length === 0 && (
          <div className="mt-3 rounded-xl border border-dashed border-wa-border p-8 text-center dark:border-wa-border-dark">
            <p className="text-sm text-wa-muted dark:text-wa-muted-dark">No hay negocios que coincidan.</p>
            <Button variant="secondary" className="mt-3" onClick={() => { setBusqueda(''); setFiltro('todos') }}>Ver todos</Button>
          </div>
        )}

        {!negocios.isLoading && !negocios.isError && organizaciones.length === 0 && (
          <div className="mt-3 flex flex-col items-center rounded-xl border border-dashed border-wa-border bg-white px-6 py-12 text-center dark:border-wa-border-dark dark:bg-wa-panel-dark">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-wa-primary/10 text-wa-primary"><Building2 className="h-6 w-6" aria-hidden="true" /></span>
            <h2 className="mt-4 text-base font-bold text-wa-text dark:text-white">Aún no hay negocios</h2>
            <p className="mt-1 max-w-sm text-sm text-wa-muted dark:text-wa-muted-dark">Crea el primero para preparar su esquema, dominio y cuenta administradora.</p>
          </div>
        )}
        {negocios.data?.head && <p className="mt-6 text-xs text-wa-muted dark:text-wa-muted-dark">Revisión de plataforma: <span className="font-mono">{negocios.data.head}</span></p>}
      </section>
    </>
  )
}
