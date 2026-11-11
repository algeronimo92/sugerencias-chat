import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

export function Tooltip({ children, content, side = 'bottom' }: { children: ReactNode; content: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <TooltipPrimitive.Provider delayDuration={450} skipDelayDuration={150}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={8}
            collisionPadding={12}
            className="ui-tooltip-content z-[150] max-w-[min(18rem,var(--radix-tooltip-content-available-width))] break-words rounded-xl border border-white/10 bg-wa-head-dark px-3 py-2 text-pretty text-xs font-medium leading-5 text-white shadow-[0_4px_16px_-4px_rgba(0,0,0,0.35),0_1px_3px_rgba(0,0,0,0.15)] dark:border-white/15 dark:bg-wa-field-dark dark:text-wa-text-dark"
          >
            {content}
            <TooltipPrimitive.Arrow width={10} height={5} className="fill-wa-head-dark dark:fill-wa-field-dark" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
