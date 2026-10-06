/**
 * Dónde está el backend. Es el único lugar que lee `VITE_API_BASE_URL`: el
 * cliente HTTP, el WebSocket y las URLs de media lo toman de acá.
 *
 * - Vacío (`""`) es el caso de producción y del entorno de Docker: el backend
 *   está en el mismo origen que la app (nginx o el proxy de Vite lo reenvían),
 *   y por eso la cookie de sesión viaja sin configurar CORS.
 * - Una URL absoluta apunta a otro origen (desarrollo fuera de Docker).
 * - Sin definir: en desarrollo se asume el backend local; en un build de
 *   producción es un error de configuración y la app se niega a arrancar, en
 *   vez de mandar todas las requests a localhost sin avisar.
 */

const DEVELOPMENT_API_BASE_URL = 'http://localhost:8000'

export function resolveApiBaseUrl(raw: string | undefined, production: boolean): string {
  if (raw !== undefined) return raw.trim().replace(/\/+$/, '')
  if (production) {
    throw new Error(
      'VITE_API_BASE_URL no está definida en el build de producción. Usá "" si el backend '
      + 'vive en el mismo origen que la app, o su URL absoluta.',
    )
  }
  return DEVELOPMENT_API_BASE_URL
}

export const API_BASE_URL = resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL, import.meta.env.PROD)

/** URL de un recurso del backend: relativa al origen de la app cuando el
 * backend vive en el mismo origen. */
export function apiUrl(path: string, base: string = API_BASE_URL): string {
  return `${base}${path}`
}

/** URL de WebSocket del backend. Con el backend en el mismo origen se arma
 * desde la ubicación actual (ws: o wss: según la página), en vez de pasarle
 * al navegador una ruta relativa que los navegadores viejos no aceptan. */
export function websocketUrl(
  path: string,
  base: string = API_BASE_URL,
  location: Pick<Location, 'protocol' | 'host'> = window.location,
): string {
  if (base) return `${base.replace(/^http/, 'ws')}${path}`
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${scheme}//${location.host}${path}`
}
