import * as DialogPrimitive from '@radix-ui/react-dialog'

export { DialogPrimitive }

export const dialogOverlayClass =
  'fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out'

export const dialogContentPositionClass =
  'fixed left-1/2 top-1/2 z-[51] -translate-x-1/2 -translate-y-1/2 outline-none'

// Para diálogos que pueden abrirse encima de VisualFlowBuilder (z-[60], una
// vista de pantalla completa, no un modal) — sin esto quedan dibujados por
// detrás y parecen no responder al click.
export const dialogOverlayClassElevated =
  'fixed inset-0 z-[75] bg-black/50 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out'

export const dialogContentPositionClassElevated =
  'fixed left-1/2 top-1/2 z-[76] -translate-x-1/2 -translate-y-1/2 outline-none'

// Para lo que se abre desde el cajón del lead en el chat (z-76, ver
// ChatWorkspace) o encima de la barra inferior (z-86). Con la capa común (z-50)
// el diálogo se dibujaba detrás del cajón: el de "Registrar compra" quedaba
// tapado a la mitad, sin el botón para confirmar, y antes le pasó lo mismo a
// "Editar lead". Todo diálogo que se abra desde la ficha del lead usa esta.
export const dialogOverlayClassOverPanel =
  'fixed inset-0 z-[87] bg-black/50 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out'

export const dialogContentPositionClassOverPanel =
  'fixed left-1/2 top-1/2 z-[88] -translate-x-1/2 -translate-y-1/2 outline-none'
