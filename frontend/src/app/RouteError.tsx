import { AlertTriangle, RefreshCw } from 'lucide-react'
import { isRouteErrorResponse, useNavigate, useRouteError } from 'react-router-dom'

import { Button } from '../shared/ui/Button'
import { extractErrorMessage } from '../shared/utils/errors'

/** Un chunk de la app que ya no existe en el servidor: pasa cuando se publicó
 *  una versión nueva con la pestaña abierta. Se arregla recargando. */
function isStaleBundle(error: unknown): boolean {
  return error instanceof TypeError && /dynamically imported module|Importing a module script failed/i.test(error.message)
}

/** Lo que se ve cuando una pantalla se rompe al renderizar o al cargar: en vez
 *  de una página en blanco, un aviso con la salida. Las rutas lo usan como
 *  `errorElement`, así el resto de la app (barra lateral incluida) sigue en pie. */
export function RouteError() {
  const error = useRouteError()
  const navigate = useNavigate()
  const staleBundle = isStaleBundle(error)

  const title = staleBundle ? 'Hay una versión nueva' : 'Esta pantalla tuvo un problema'
  const detail = staleBundle
    ? 'Recargá la página para usar la última versión.'
    : isRouteErrorResponse(error)
      ? `${error.status} ${error.statusText}`
      : extractErrorMessage(error)

  return (
    <main className="flex h-full items-center justify-center bg-wa-app p-4 dark:bg-wa-app-dark">
      <div role="alert" className="w-full max-w-md rounded-2xl border border-red-200 bg-white p-6 text-center shadow-xl dark:border-red-900 dark:bg-wa-panel-dark">
        <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </span>
        <h1 className="mt-4 text-lg font-semibold text-wa-text dark:text-wa-text-dark">{title}</h1>
        <p className="mt-3 rounded-lg bg-wa-field px-3 py-2 text-xs text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark">
          {detail}
        </p>
        <div className="mt-5 flex justify-center gap-2">
          {!staleBundle && (
            <Button variant="ghost" onClick={() => navigate('/')}>
              Ir al inicio
            </Button>
          )}
          <Button onClick={() => window.location.reload()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Recargar
          </Button>
        </div>
      </div>
    </main>
  )
}
