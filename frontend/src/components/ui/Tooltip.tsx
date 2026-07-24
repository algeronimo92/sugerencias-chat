import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

export function Tooltip({ children, content, side = 'bottom' }: { children: ReactNode; content: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={100}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content side={side} sideOffset={6} collisionPadding={8} className="z-[150] max-w-64 rounded-md bg-wa-head-dark px-2.5 py-1.5 text-xs text-white shadow-lg data-[state=delayed-open]:animate-in dark:bg-wa-active-dark dark:text-wa-text-dark">
            {content}
            <TooltipPrimitive.Arrow className="fill-wa-head-dark dark:fill-wa-active-dark" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
