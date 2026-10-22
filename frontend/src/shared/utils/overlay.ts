/**
 * ¿Hay una capa modal abierta por encima del contenido principal?
 *
 * La usa el Escape global para no cerrar el lead que está detrás de un diálogo:
 * la tecla la atiende siempre la capa de más arriba, y el lead recién cuando no
 * queda nada encima.
 *
 * Se le pregunta al DOM en vez de mantener una lista de flags en App. Los
 * diálogos —los de Radix y los propios de la app— solo existen en el DOM
 * mientras están abiertos y se anuncian con `role="dialog"` o
 * `role="alertdialog"`, así que un modal nuevo queda cubierto sin tener que
 * acordarse de registrarlo en ningún lado.
 *
 * Sirve leerlo dentro del handler de Escape aunque el diálogo ya se haya
 * cerrado a sí mismo: React aplica el desmontaje después de que corren los
 * listeners del evento, así que durante ese Escape el modal sigue en el DOM —
 * que es justo lo que hace que una pulsación cierre una sola capa.
 */
export function hasOpenOverlay(): boolean {
  return document.querySelector('[role="dialog"], [role="alertdialog"]') !== null
}
