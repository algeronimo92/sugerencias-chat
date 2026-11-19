import * as Menu from '@radix-ui/react-dropdown-menu'
import type { LucideIcon } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../utils/cn'
import { Tooltip } from './Tooltip'

interface DropdownMenuProps {
  /** El botón que abre el menú; tiene que poder recibir una ref (un `<button>`). */
  trigger: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  align?: 'start' | 'center' | 'end'
  /** Cabecera opcional, no seleccionable (nombre y rol en el menú de la cuenta). */
  header?: ReactNode
  /** Nombre visible al pasar el mouse, para botones que solo muestran un icono. */
  tooltip?: string
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

/**
 * Menú desplegable accesible (doc 18 §5.11). Radix resuelve lo que a mano
 * fallaba: flechas para recorrer, Escape para cerrar, foco de vuelta al botón
 * y el rol `menu` para los lectores de pantalla.
 *
 * z-[145]: la misma capa que el Select, por encima de cualquier diálogo y
 * debajo de los tooltips.
 */
export function DropdownMenu({ trigger, children, side = 'bottom', align = 'start', header, tooltip, tooltipSide = 'right' }: DropdownMenuProps) {
  // El tooltip envuelve al disparador del menú y no al revés: así los dos
  // comparten el mismo <button> y el menú sigue abriéndose con un clic.
  const menuTrigger = <Menu.Trigger asChild>{trigger}</Menu.Trigger>
  return (
    <Menu.Root>
      {tooltip ? <Tooltip content={tooltip} side={tooltipSide}>{menuTrigger}</Tooltip> : menuTrigger}
      <Menu.Portal>
        <Menu.Content
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={8}
          className="ui-select-content z-[145] min-w-56 rounded-xl border border-line bg-surface-raised p-1 text-fg shadow-popover outline-none"
        >
          {header && (
            <>
              <div className="px-3 py-2">{header}</div>
              <Menu.Separator className="mx-1 my-1 h-px bg-line" />
            </>
          )}
          {children}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  )
}

interface ItemProps {
  icon?: LucideIcon
  children: ReactNode
  onSelect: () => void
  /** Acciones que cierran algo (cerrar sesión): texto de peligro. */
  danger?: boolean
}

export function DropdownMenuItem({ icon: Icon, children, onSelect, danger = false }: ItemProps) {
  return (
    <Menu.Item
      onSelect={onSelect}
      className={cn(
        'flex h-10 cursor-default select-none items-center gap-3 rounded-lg px-3 text-sm outline-none transition-colors data-[disabled]:opacity-50',
        danger ? 'text-danger-fg data-[highlighted]:bg-danger-soft' : 'text-fg data-[highlighted]:bg-subtle',
      )}
    >
      {Icon && <Icon className={cn('h-4.5 w-4.5 shrink-0', danger ? 'text-danger-fg' : 'text-fg-muted')} strokeWidth={1.75} aria-hidden="true" />}
      {children}
    </Menu.Item>
  )
}

export function DropdownMenuSeparator() {
  return <Menu.Separator className="mx-1 my-1 h-px bg-line" />
}
