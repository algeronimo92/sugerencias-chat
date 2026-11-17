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
