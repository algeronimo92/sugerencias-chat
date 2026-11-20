import { Bell } from 'lucide-react'
import { Tooltip } from '../../../shared/ui/Tooltip'

export type NotificationPlacement = 'header' | 'rail' | 'toolbar'

const TOOLTIP_SIDE = { header: 'bottom', rail: 'right', toolbar: 'top' } as const
const SIZE_CLASS = { header: 'h-10 w-10', rail: 'h-10 w-full', toolbar: 'h-9 w-9' }

interface Props {
  placement: NotificationPlacement
  open: boolean
  unreadCount: number
  onToggle: () => void
}

/** Campana del centro de notificaciones con el número de no leídas. */
export function NotificationBellButton({ placement, open, unreadCount, onToggle }: Props) {
  return (
    <Tooltip content="Notificaciones" side={TOOLTIP_SIDE[placement]}>
      <button
        type="button"
        onClick={onToggle}
        aria-label="Centro de notificaciones"
        aria-expanded={open}
        className={`relative flex items-center justify-center rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring ${SIZE_CLASS[placement]} ${open ? 'bg-selected text-fg' : 'text-fg-muted hover:bg-subtle hover:text-fg'}`}
      >
        <span className="relative flex shrink-0">
          <Bell className={placement === 'header' ? 'h-4.5 w-4.5' : 'h-5 w-5'} strokeWidth={1.75} aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="absolute -right-2.5 -top-2 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-accent-fill px-1 text-[11px] font-semibold leading-none tabular-nums text-on-accent ring-2 ring-surface">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </span>
      </button>
    </Tooltip>
  )
}
