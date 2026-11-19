import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ReactNode } from 'react'

export function Tooltip({ children, content, side = 'bottom' }: { children: ReactNode; content: ReactNode; side?: 'top' | 'right' | 'bottom' | 'left' }) {
  // Sin texto no hay globo: así quien lo usa puede apagarlo sin cambiar el árbol.
  if (content == null || content === '') return <>{children}</>
  return (
    <TooltipPrimitive.Provider delayDuration={450} skipDelayDuration={150}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={8}
            collisionPadding={12}
            className="ui-tooltip-content z-[150] max-w-[min(18rem,var(--radix-tooltip-content-available-width))] break-words rounded-xl bg-fg px-3 py-2 text-pretty text-xs font-medium leading-5 text-surface shadow-popover"
          >
            {content}
            <TooltipPrimitive.Arrow width={10} height={5} className="fill-fg" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
