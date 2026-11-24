/** Recarga la página. Aparte para que los tests la reemplacen: jsdom no recarga. */
export function reloadPage() {
  window.location.reload()
}

let reloading = false

/**
 * Recarga una sola vez por carga de página.
 *
 * Al aplicar una versión nueva hay dos avisos que piden recargar: el de
 * vite-plugin-pwa (`controlling`, el worker nuevo toma el control) y el de
 * `reloadWhenActivated` (el worker queda `activated`). Llegan con
 * milisegundos de diferencia y antes se hacían dos `location.reload()`
 * seguidos. En la PWA instalada en Android (visto en Xiaomi, 2026-11-17) la
 * segunda recarga cae mientras Chrome rearma la ventana y la barra de
 * botones del sistema desaparecía hasta recargar a mano.
 */
export function reloadPageOnce(reload: () => void = reloadPage) {
  if (reloading) return
  reloading = true
  reload()
}

/** Solo para tests: en el navegador la recarga reinicia el módulo. */
export function resetReloadGuard() {
  reloading = false
}

/**
 * Recarga en cuanto el worker nuevo queda activo, o ya mismo si no queda
 * ninguno esperando.
 *
 * vite-plugin-pwa solo recarga cuando ve `controlling` marcado como
 * actualización, y eso exige que la página ya estuviera controlada al cargar.
 * Una pestaña abierta con recarga forzada (Shift+recargar), la primera visita
 * o una pestaña cuya versión ya aplicó otra no lo ven nunca. El 2026-11-10
 * "Actualizar" terminaba en "No se pudo aplicar la versión nueva" a los 15 s
 * en una pestaña así, aunque el worker nuevo sí se activaba.
 */
export function reloadWhenActivated(registration: ServiceWorkerRegistration | null, reload: () => void = reloadPage) {
  const worker = registration?.waiting
  if (!worker) {
    // Otra pestaña ya lo activó: recargar alcanza para tomar la versión nueva.
    reloadPageOnce(reload)
    return
  }
  const onStateChange = () => {
    if (worker.state !== 'activated') return
    worker.removeEventListener('statechange', onStateChange)
    reloadPageOnce(reload)
  }
  worker.addEventListener('statechange', onStateChange)
}

/** Cuánto se espera a que baje una versión más nueva antes de aplicar la que ya hay. */
export const LATEST_CHECK_TIMEOUT_MS = 10_000

/**
 * Pregunta al servidor si hay un build más nuevo que el que espera y, si lo
 * hay, espera a que termine de bajar: así "Actualizar" salta directo a la
 * última versión y no a la que se detectó antes.
 *
 * Sin esto, con dos deploys seguidos (#290 y #291, 2026-11-24, a un minuto
 * de distancia) la pestaña aplicaba el primero, porque el segundo caía dentro
 * del tope de 5 minutos entre búsquedas, y al recargar volvía a pedir
 * actualizar. El worker nuevo reemplaza al que esperaba, y el plugin le manda
 * `SKIP_WAITING` a `registration.waiting`: el más nuevo.
 *
 * Nunca falla ni bloquea: sin red o pasado el tope se aplica lo que ya había.
 */
export function settleLatestWorker(
  registration: ServiceWorkerRegistration | null,
  timeoutMs: number = LATEST_CHECK_TIMEOUT_MS,
): Promise<void> {
  if (!registration) return Promise.resolve()
  return new Promise(resolve => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      window.clearTimeout(timeoutId)
      resolve()
    }
    const timeoutId = window.setTimeout(finish, timeoutMs)
    registration.update().then(() => {
      const installing = registration.installing
      if (!installing) return finish()
      const onStateChange = () => {
        if (installing.state === 'installing') return
        installing.removeEventListener('statechange', onStateChange)
        finish()
      }
      installing.addEventListener('statechange', onStateChange)
      onStateChange()
    }, finish)
  })
}
