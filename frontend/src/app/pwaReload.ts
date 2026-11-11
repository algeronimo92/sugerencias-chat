/** Recarga la página. Aparte para que los tests la reemplacen: jsdom no recarga. */
export function reloadPage() {
  window.location.reload()
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
    reload()
    return
  }
  const onStateChange = () => {
    if (worker.state !== 'activated') return
    worker.removeEventListener('statechange', onStateChange)
    reload()
  }
  worker.addEventListener('statechange', onStateChange)
}
