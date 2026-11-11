/**
 * Panel de plataforma: alta y administración de negocios.
 *
 * Deliberadamente aislado del CRM: su propia sesión (cookie distinta), sus
 * propias llamadas (`/api/platform/*`) y ningún import del árbol de chats. El
 * backend solo lo atiende en los hosts de plataforma; en el dominio de un
 * negocio estas rutas devuelven 404 y acá se ve como "panel no disponible".
 *
 * Este archivo solo decide qué se muestra según la sesión del operador. El
 * panel en sí vive en `panel/`: PlatformShell (menú y secciones),
 * BusinessDirectory (lista de negocios) y BusinessWorkspace (un negocio).
 */
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { asApiError } from '../../../shared/http/errors'
import { BackendUnavailable } from '../../../shared/ui/BackendUnavailable'
import { fetchOperator } from '../api'
import { platformKeys } from '../keys'
import { mensajeDeError } from './panel/errors'
import { PlatformLogin } from './panel/PlatformLogin'
import { PlatformShell } from './panel/PlatformShell'

export function PlatformApp() {
  const queryClient = useQueryClient()
  // El panel no toma la marca de ningún negocio (ver main.tsx).
  useEffect(() => {
    document.title = 'Cliniventas · Panel de plataforma'
  }, [])
  const sesion = useQuery({
    queryKey: platformKeys.me,
    queryFn: async () => {
      try {
        return await fetchOperator()
      } catch (error) {
        // 401 = todavía no entró. 404 = el panel no vive en este dominio, que
        // es la respuesta esperada desde el CRM de un negocio.
        const status = asApiError(error)?.status
        if (status === 401 || status === 404) {
          return null
        }
        throw error
      }
    },
    retry: false,
  })

  const recargarSesion = () => queryClient.invalidateQueries({ queryKey: platformKeys.me })

  if (sesion.isLoading) {
    return (
      <div role="status" className="flex h-full items-center justify-center bg-wa-app text-wa-muted dark:bg-wa-app-dark dark:text-wa-muted-dark">
        Cargando panel…
      </div>
    )
  }
  if (sesion.isError) {
    const detail = asApiError(sesion.error)?.isNetwork
      ? 'No se pudo establecer conexión con el servidor.'
      : mensajeDeError(sesion.error)
    return <BackendUnavailable detail={detail} isRetrying={sesion.isFetching} onRetry={recargarSesion} />
  }
  if (!sesion.data) {
    return <PlatformLogin onEntrar={recargarSesion} />
  }
  return <PlatformShell operador={sesion.data} onSalir={recargarSesion} />
}
