import { useNavigate, useLocation } from 'react-router-dom'
import { isNavItemActive, visibleNavItems } from '../domain/navigation'
import { Tooltip } from './ui/Tooltip'

type Props = {
  isAdmin: boolean
  unreadCount: number
}

// Solo iconos: el nombre de cada vista vive en el tooltip. Sin las etiquetas
// el riel no necesita ancho para texto y le devuelve ese espacio al chat.
const SIDEBAR_WIDTH_CLASS = 'w-[60px]'

const itemClass = (active: boolean) =>
  `group relative flex h-11 w-11 items-center justify-center rounded-xl outline-none transition-all focus-visible:ring-2 focus-visible:ring-wa-primary/60 ${
    active
      ? 'bg-wa-primary/12 text-wa-primary-strong shadow-sm ring-1 ring-wa-primary/15 dark:bg-wa-primary/15 dark:text-wa-primary dark:ring-wa-primary/20'
      : 'text-wa-muted hover:bg-wa-hover hover:text-wa-text dark:text-wa-muted-dark dark:hover:bg-wa-head-dark dark:hover:text-wa-text-dark'
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
      className={`flex ${SIDEBAR_WIDTH_CLASS} shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-wa-border bg-white py-3 dark:border-wa-border-dark dark:bg-wa-panel-dark`}
    >
      {items.map((item, index) => {
        const Icon = item.icon
        const active = isNavItemActive(item, location.pathname)
        const showBadge = item.path === '/' && unreadCount > 0
        const previous = items[index - 1]
        const showDivider = item.adminOnly && !(previous?.adminOnly ?? false)

        return (
          <div key={item.path} className="flex flex-col items-center">
            {showDivider && <div className="my-1.5 h-px w-10 bg-wa-border dark:bg-wa-border-dark" />}
            <Tooltip content={item.label} side="right">
              <button type="button" onClick={() => navigate(item.path)} aria-label={item.label} className={itemClass(active)}>
                <span className="relative">
                  <Icon className="h-5.25 w-5.25" strokeWidth={active ? 2.4 : 1.8} />
                  {showBadge && (
                    <span className="absolute -right-3 -top-2 flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-4 text-white ring-2 ring-white dark:ring-wa-panel-dark">
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
