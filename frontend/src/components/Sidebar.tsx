import { useNavigate, useLocation } from 'react-router-dom'
import { isNavItemActive, visibleNavItems } from '../domain/navigation'
import { Tooltip } from './ui/Tooltip'

type Props = {
  isAdmin: boolean
  unreadCount: number
}

const SIDEBAR_WIDTH_CLASS = 'w-14'

const itemClass = (active: boolean) =>
  `flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
    active
      ? 'bg-white/25 text-white dark:bg-wa-field-dark dark:text-white dark:ring-1 dark:ring-white/[0.06]'
      : 'text-white/80 hover:bg-white/10 hover:text-white dark:text-wa-muted-dark dark:hover:bg-wa-head-dark dark:hover:text-wa-text-dark'
  }`

/**
 * Navegación para tablet y desktop. Reemplaza a la fila horizontal que vivía
 * en la barra superior: con diez vistas ya no entraban cómodas ahí.
 */
export function Sidebar({ isAdmin, unreadCount }: Props) {
  const navigate = useNavigate()
  const location = useLocation()

  const items = visibleNavItems(isAdmin)

  return (
    <nav
      aria-label="Vista principal"
      className={`flex ${SIDEBAR_WIDTH_CLASS} shrink-0 flex-col items-center gap-0.5 border-r border-wa-primary-deep bg-wa-primary-strong py-2 dark:border-wa-border-dark dark:bg-wa-panel-dark`}
    >
      {items.map((item, index) => {
        const Icon = item.icon
        const active = isNavItemActive(item, location.pathname)
        const showBadge = item.path === '/' && unreadCount > 0
        const previous = items[index - 1]
        const showDivider = item.adminOnly && !(previous?.adminOnly ?? false)

        return (
          <div key={item.path} className="flex flex-col items-center">
            {showDivider && <div className="my-1 h-px w-8 bg-white/15 dark:bg-white/10" />}
            <Tooltip content={item.label} side="right">
              <button type="button" onClick={() => navigate(item.path)} aria-label={item.label} className={itemClass(active)}>
                <span className="relative">
                  <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.9} />
                  {showBadge && (
                    <span className="absolute -right-2.5 -top-1 flex min-w-4 items-center justify-center rounded-full bg-white px-1 text-[10px] font-semibold leading-4 text-wa-primary-strong dark:bg-wa-primary dark:text-white">
                      {unreadCount > 99 ? '99+' : unreadCount}
                    </span>
                  )}
                </span>
              </button>
            </Tooltip>
          </div>
        )
      })}
    </nav>
  )
}
