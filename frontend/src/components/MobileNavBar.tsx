import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { MoreHorizontal } from 'lucide-react'
import { isNavItemActive, visibleNavItems } from '../domain/navigation'
import type { NavItem } from '../domain/navigation'

type Props = {
  isAdmin: boolean
  unreadCount: number
}

const tabClass = (active: boolean) =>
  `flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 transition-colors ${
    active
      ? 'text-wa-primary-strong dark:text-wa-primary'
      : 'text-wa-muted dark:text-wa-muted-dark'
  }`

/**
 * Navegación inferior para pantallas chicas. Reemplaza a las pestañas de la
 * barra superior, que con siete vistas y un pulgar no eran usables.
 */
export function MobileNavBar({ isAdmin, unreadCount }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const [isMoreOpen, setIsMoreOpen] = useState(false)

  const items = visibleNavItems(isAdmin)
  const primaryItems = items.filter((item) => item.primary)
  const secondaryItems = items.filter((item) => !item.primary)

  function go(item: NavItem) {
    setIsMoreOpen(false)
    navigate(item.path)
  }

  const isSecondaryActive = secondaryItems.some((item) => isNavItemActive(item, location.pathname))

  return (
    <>
      <AnimatePresence>
        {isMoreOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setIsMoreOpen(false)}
              className="fixed inset-0 z-[85] bg-black/40"
            />
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              role="dialog"
              aria-label="Más vistas"
              className="fixed inset-x-0 bottom-0 z-[86] rounded-t-2xl border-t border-wa-border bg-white pb-safe dark:border-wa-border-dark dark:bg-wa-panel-dark"
            >
              <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-wa-border dark:bg-wa-border-dark" />
              <div className="grid grid-cols-2 gap-1 p-3">
                {secondaryItems.map((item) => {
                  const Icon = item.icon
                  const active = isNavItemActive(item, location.pathname)
                  return (
                    <button
                      key={item.path}
                      type="button"
                      onClick={() => go(item)}
                      className={`flex min-h-14 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors ${
                        active
                          ? 'bg-wa-primary/10 text-wa-primary-strong dark:bg-wa-primary/15 dark:text-wa-primary'
                          : 'text-wa-text hover:bg-wa-hover dark:text-wa-text-dark dark:hover:bg-wa-hover-dark'
                      }`}
                    >
                      <Icon className="h-5 w-5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  )
                })}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>

      <nav
        aria-label="Vista principal"
        className="flex shrink-0 items-stretch border-t border-wa-border bg-white pb-safe dark:border-wa-border-dark dark:bg-wa-panel-dark"
      >
        {primaryItems.map((item) => {
          const Icon = item.icon
          const active = isNavItemActive(item, location.pathname)
          const showBadge = item.path === '/' && unreadCount > 0
          return (
            <button key={item.path} type="button" onClick={() => go(item)} className={tabClass(active)}>
              <span className="relative">
                <Icon className="h-5 w-5" strokeWidth={active ? 2.4 : 1.9} />
                {showBadge && (
                  <span className="absolute -right-2.5 -top-1 flex min-w-4 items-center justify-center rounded-full bg-wa-primary px-1 text-[10px] font-semibold leading-4 text-white">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                )}
              </span>
              <span className="text-[10px] font-medium">{item.label}</span>
            </button>
          )
        })}

        {secondaryItems.length > 0 && (
          <button
            type="button"
            onClick={() => setIsMoreOpen((open) => !open)}
            aria-expanded={isMoreOpen}
            className={tabClass(isMoreOpen || isSecondaryActive)}
          >
            <MoreHorizontal className="h-5 w-5" strokeWidth={isSecondaryActive ? 2.4 : 1.9} />
            <span className="text-[10px] font-medium">Más</span>
          </button>
        )}
      </nav>
    </>
  )
}
