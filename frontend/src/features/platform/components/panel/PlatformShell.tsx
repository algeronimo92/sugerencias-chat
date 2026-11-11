import { useMutation } from '@tanstack/react-query'
import { BookText, Building2, Loader2, LogOut, Moon, Plug, Sun, UserRound, type LucideIcon } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { useTheme } from '../../../../shared/hooks/useTheme'
import { logoutOperator } from '../../api'
import type { OperadorActual } from '../../types'
import { KnowledgeTemplatesPanel } from '../KnowledgeTemplatesPanel'
import { PlatformCredentials } from '../PlatformCredentials'
import { BusinessDirectory } from './BusinessDirectory'
import { BusinessWorkspace } from './BusinessWorkspace'
import { PanelLink } from './PanelLink'
import { PanelNavContext, hashDeRuta, rutaSeccion, usePanelRoute, type SeccionPanel } from './panelRoute'
import { MarcaPlataforma } from './PanelUi'

// Dos grupos a propósito: lo que se administra negocio por negocio y lo que la
// plataforma comparte con todos. Mezclarlos en una fila de pestañas hacía que
// "Integraciones" (credenciales comunes) pareciera algo de cada negocio.
const GRUPOS: { titulo: string; items: { id: SeccionPanel; label: string; icon: LucideIcon }[] }[] = [
  { titulo: 'Negocios', items: [{ id: 'negocios', label: 'Negocios', icon: Building2 }] },
  {
    titulo: 'Común a todos',
    items: [
      { id: 'integraciones', label: 'Integraciones', icon: Plug },
      { id: 'plantillas', label: 'Plantillas de IA', icon: BookText },
    ],
  },
]

const botonBarraClass =
  'flex h-10 items-center justify-center gap-2 rounded-lg border border-wa-border bg-white text-sm font-semibold text-wa-muted transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-primary disabled:opacity-50 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-muted-dark'

export function PlatformShell({ operador, onSalir }: { operador: OperadorActual; onSalir: () => void }) {
  const navegacion = usePanelRoute()
  const { ruta } = navegacion
  const { theme, toggleTheme } = useTheme()
  const contenido = useRef<HTMLElement>(null)
  const salir = useMutation({
    mutationFn: async () => {
      await logoutOperator()
    },
    onSuccess: onSalir,
  })

  // Cada pantalla empieza arriba: el contenido tiene su propio scroll y, sin
  // esto, entrar a un negocio desde el final del directorio lo abría a medias.
  const destino = hashDeRuta(ruta)
  useEffect(() => {
    contenido.current?.scrollTo?.({ top: 0 })
  }, [destino])

  return (
    <PanelNavContext value={navegacion}>
      <div className="flex h-full flex-col bg-wa-app text-wa-text lg:flex-row dark:bg-wa-app-dark dark:text-wa-text-dark">
        {/* Una sola barra: lateral en escritorio, cabecera con el menú debajo
            en pantallas chicas (la rejilla sube las acciones junto a la marca). */}
        <aside className="grid shrink-0 grid-cols-[minmax(0,1fr)_auto] border-b border-wa-border bg-white lg:flex lg:w-64 lg:flex-col lg:border-b-0 lg:border-r dark:border-wa-border-dark dark:bg-wa-panel-dark">
          <div className="col-start-1 row-start-1 flex min-h-16 items-center px-4 lg:px-5">
            <MarcaPlataforma />
          </div>

          <nav aria-label="Secciones del panel" className="col-span-2 row-start-2 overflow-x-auto border-t border-wa-border px-2 lg:mt-2 lg:overflow-visible lg:border-t-0 lg:px-3 dark:border-wa-border-dark">
            <div className="flex gap-1 lg:flex-col lg:gap-5">
              {GRUPOS.map((grupo) => (
                <div key={grupo.titulo} role="group" aria-label={grupo.titulo} className="flex shrink-0 gap-1 lg:flex-col">
                  <p aria-hidden="true" className="hidden px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-wa-muted lg:block dark:text-wa-muted-dark">
                    {grupo.titulo}
                  </p>
                  {grupo.items.map(({ id, label, icon: Icon }) => {
                    const elegido = ruta.seccion === id
                    return (
                      <PanelLink
                        key={id}
                        to={rutaSeccion(id)}
                        aria-current={elegido ? 'page' : undefined}
                        className={`inline-flex min-h-11 shrink-0 items-center gap-2.5 border-b-2 px-3 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-wa-primary lg:rounded-lg lg:border-b-0 ${elegido ? 'border-wa-primary text-wa-primary-strong lg:bg-wa-primary/10 dark:text-wa-primary' : 'border-transparent text-wa-muted hover:text-wa-text lg:hover:bg-wa-hover dark:text-wa-muted-dark dark:hover:text-wa-text-dark dark:lg:hover:bg-wa-hover-dark'}`}
                      >
                        <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                        {label}
                      </PanelLink>
                    )
                  })}
                </div>
              ))}
            </div>
          </nav>

          <div className="col-start-2 row-start-1 flex items-center gap-2 px-4 lg:mt-auto lg:flex-col lg:items-stretch lg:gap-3 lg:border-t lg:border-wa-border lg:p-4 dark:lg:border-wa-border-dark">
            <div className="hidden min-w-0 items-center gap-2.5 sm:flex">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-wa-primary/10 text-wa-primary-strong dark:text-wa-primary"><UserRound className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0">
                <span className="block max-w-40 truncate text-xs font-semibold text-wa-text dark:text-white">{operador.name}</span>
                <span className="hidden max-w-40 truncate text-xs text-wa-muted lg:block dark:text-wa-muted-dark">{operador.email}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={toggleTheme} aria-label={theme === 'dark' ? 'Activar modo claro' : 'Activar modo oscuro'} className={`${botonBarraClass} w-10 shrink-0 hover:text-wa-primary-strong dark:hover:text-wa-primary`}>
                {theme === 'dark' ? <Sun className="h-4 w-4" aria-hidden="true" /> : <Moon className="h-4 w-4" aria-hidden="true" />}
              </button>
              <button type="button" onClick={() => salir.mutate()} disabled={salir.isPending} aria-label="Cerrar sesión" className={`${botonBarraClass} px-3 hover:text-red-600 lg:flex-1 dark:hover:text-red-300`}>
                {salir.isPending ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LogOut className="h-4 w-4" aria-hidden="true" />}
                <span className="hidden sm:inline">Cerrar sesión</span>
              </button>
            </div>
          </div>
        </aside>

        <main ref={contenido} className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
            {ruta.seccion === 'negocios' && (ruta.negocioId
              ? <BusinessWorkspace negocioId={ruta.negocioId} apartado={ruta.apartado} />
              : <BusinessDirectory />)}

            {ruta.seccion === 'integraciones' && (
              <>
                <h1 className="text-3xl font-bold tracking-[-0.03em] text-wa-text dark:text-white">Integraciones</h1>
                <p className="mt-2 mb-6 max-w-2xl text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
                  Credenciales que la plataforma comparte con todos los negocios, ordenadas por app. Cada tarjeta se guarda por separado.
                </p>
                <PlatformCredentials />
              </>
            )}

            {ruta.seccion === 'plantillas' && <KnowledgeTemplatesPanel />}
          </div>
        </main>
      </div>
    </PanelNavContext>
  )
}
