import * as DialogPrimitive from '@radix-ui/react-dialog'

export { DialogPrimitive }

export const dialogOverlayClass =
  'fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out'

export const dialogContentPositionClass =
  'fixed left-1/2 top-1/2 z-[51] -translate-x-1/2 -translate-y-1/2 outline-none'
