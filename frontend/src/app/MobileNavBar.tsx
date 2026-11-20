import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, m } from 'motion/react'
import { Bug, LogOut, Moon, MoreHorizontal, Settings as SettingsIcon, Sun, type LucideIcon } from 'lucide-react'
import { Counter } from '../shared/ui/Badge'
import { isNavItemActive, MOBILE_TAB_PATHS, visibleNavItems } from './navigation'
import type { NavItem } from './navigation'

/** Lo que en escritorio son íconos de la barra superior. */
export type MobileAccountActions = {
  onOpenSettings?: () => void
  onOpenIssueReport?: () => void
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onLogout: () => void
}

type Props = {
  role: string | undefined
  unreadCount: number
  account: MobileAccountActions
}

const tabClass = (active: boolean) =>
  `flex min-h-11 flex-1 flex-col items-center justify-center gap-0.5 px-1 transition-colors ${
    active
      ? 'font-semibold text-accent-strong'
      : 'font-medium text-fg-muted'
  }`

/**
 * Navegación inferior para pantallas chicas. Reemplaza a las pestañas de la
 * barra superior, que con siete vistas y un pulgar no eran usables.
 *
 * "Más" también reúne las acciones de la cuenta (configuración, reportar,
 * tema, cerrar sesión): en el celular eran seis íconos de 28 px apretados en
 * la barra superior, que además cortaba el nombre del negocio.
 */
export function MobileNavBar({ role, unreadCount, account }: Props) {
  const navigate = useNavigate()
  const location = useLocation()
  const [isMoreOpen, setIsMoreOpen] = useState(false)

  // El panel "Más" se superpone a toda la app: sin esto quedaba sin forma de
  // cerrarlo con teclado.
  useEffect(() => {
    if (!isMoreOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setIsMoreOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isMoreOpen])

  const items = visibleNavItems(role)
  const primaryItems = MOBILE_TAB_PATHS.flatMap((path) => items.filter((item) => item.path === path))
  const secondaryItems = items.filter((item) => !MOBILE_TAB_PATHS.includes(item.path))

  function go(item: NavItem) {
    setIsMoreOpen(false)
    navigate(item.path)
  }

  const isSecondaryActive = secondaryItems.some((item) => isNavItemActive(item, location.pathname))

  const accountActions: { label: string; icon: LucideIcon; run: () => void; danger?: boolean }[] = [
    ...(account.onOpenSettings ? [{ label: 'Configuración', icon: SettingsIcon, run: account.onOpenSettings }] : []),
    ...(account.onOpenIssueReport ? [{ label: 'Reportar un problema', icon: Bug, run: account.onOpenIssueReport }] : []),
    {
      label: account.theme === 'dark' ? 'Modo claro' : 'Modo oscuro',
      icon: account.theme === 'dark' ? Sun : Moon,
      run: account.onToggleTheme,
    },
    { label: 'Cerrar sesión', icon: LogOut, run: account.onLogout, danger: true },
  ]

  function runAccountAction(run: () => void) {
    setIsMoreOpen(false)
    run()
  }

  return (
    <>
      <AnimatePresence>
        {isMoreOpen && (
          <>
            <m.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.15 }}
              onClick={() => setIsMoreOpen(false)}
              /* aria-hidden y sin handler de teclado a propósito: un fondo de
                 modal no debe ser un punto de tabulación más. Con teclado se
                 cierra con Escape. */
              aria-hidden="true"
              className="fixed inset-0 z-85 bg-scrim"
            />
            <m.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              role="dialog"
              aria-label="Más vistas"
              className="fixed inset-x-0 bottom-0 z-86 rounded-t-2xl bg-surface-raised pb-safe shadow-overlay"
            >
              <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-line-control/50" />
              <div className="max-h-[75dvh] overflow-y-auto">
                {secondaryItems.length > 0 && (
                  <div className="grid grid-cols-2 gap-1 p-3">
                    {secondaryItems.map((item) => {
                      const Icon = item.icon
                      const active = isNavItemActive(item, location.pathname)
                      return (
                        <button
                          key={item.path}
                          type="button"
                          onClick={() => go(item)}
                          className={`flex min-h-14 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium leading-tight transition-colors ${
                            active
                              ? 'bg-selected font-semibold text-fg'
                              : 'text-fg hover:bg-subtle'
                          }`}
                        >
                          <Icon className="h-5 w-5 shrink-0 text-fg-muted" strokeWidth={1.75} aria-hidden="true" />
                          {/* Sin truncate: "Automatizaciones" se cortaba en
                              "Automatizacion…" a 375 px. Si no entra en una
                              línea, se divide con guion (el documento es lang="es"). */}
                          <span className="min-w-0 hyphens-auto">{item.label}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
                <div className="border-t border-line px-3 pb-3 pt-2">
                  <p className="px-2.5 pb-1 text-xs font-semibold text-fg-muted">
                    Tu cuenta
                  </p>
                  <div className="grid grid-cols-2 gap-1">
                    {accountActions.map(({ label, icon: Icon, run, danger }) => (
                      <button
                        key={label}
                        type="button"
                        onClick={() => runAccountAction(run)}
                        className={`flex min-h-12 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium leading-tight transition-colors ${
                          danger
                            ? 'text-danger-fg hover:bg-danger-soft'
                            : 'text-fg hover:bg-subtle'
                        }`}
                      >
                        <Icon className="h-5 w-5 shrink-0" strokeWidth={1.75} aria-hidden="true" />
                        <span className="min-w-0 hyphens-auto">{label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </m.div>
          </>
        )}
      </AnimatePresence>

      <nav
        aria-label="Vista principal"
        className="flex shrink-0 items-stretch border-t border-line bg-surface pb-safe"
      >
        {primaryItems.map((item) => {
          const Icon = item.icon
          const active = isNavItemActive(item, location.pathname)
          const showBadge = item.path === '/' && unreadCount > 0
          return (
            <button key={item.path} type="button" onClick={() => go(item)} className={tabClass(active)}>
              <span className="relative">
                <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
                {/* El mismo contador que el riel de escritorio: antes era rojo
                    allá y verde acá (doc 18 §3.2). */}
                {showBadge && <Counter value={unreadCount} className="absolute -right-3.5 -top-2 ring-2 ring-surface" />}
              </span>
              <span className="text-xs">{item.label}</span>
            </button>
          )
        })}

        {/* Siempre visible: aunque el rol no tenga vistas secundarias (el
            analista), "Más" es donde se cierra sesión en el celular. */}
        <button
          type="button"
          onClick={() => setIsMoreOpen((open) => !open)}
          aria-expanded={isMoreOpen}
          className={tabClass(isMoreOpen || isSecondaryActive)}
        >
          <MoreHorizontal className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          <span className="text-xs">Más</span>
        </button>
      </nav>
    </>
  )
}
