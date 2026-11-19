import { useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { Bug, ChevronsLeft, ChevronsRight, CircleHelp, ClipboardList, LogOut, Moon, Settings as SettingsIcon, ShieldCheck, Sun } from 'lucide-react'
import { isNavItemActive, NAV_GROUP_LABELS, visibleNavItems, type NavGroup, type NavItem } from './navigation'
import { useMediaQuery } from '../shared/hooks/useBreakpoint'
import { cn } from '../shared/utils/cn'
import { Avatar } from '../shared/ui/Avatar'
import { Counter } from '../shared/ui/Badge'
import { BrandLogo } from '../shared/ui/BrandLogo'
import { DropdownMenu, DropdownMenuItem, DropdownMenuSeparator } from '../shared/ui/DropdownMenu'
import { Tooltip } from '../shared/ui/Tooltip'

// Preferencia por equipo, no por usuario en el servidor: es comodidad, no dato.
const EXPANDED_KEY = 'rail-expanded'
// Desde 1600 px el riel con etiquetas no le quita ancho útil al chat.
const WIDE_QUERY = '(min-width: 1600px)'

function readStoredExpanded(): boolean | null {
  try {
    const value = localStorage.getItem(EXPANDED_KEY)
    return value === null ? null : value === 'true'
  } catch {
    return null
  }
}

/**
 * Ítem del riel (doc 18 §5.1): reposo gris, hover con fondo suave y activo
 * con el color de acento y semibold, sin bloque de fondo. El nombre va
 * siempre en el texto: en compacto queda solo para lectores y en el tooltip.
 */
function railItemClass(active: boolean, expanded: boolean): string {
  return cn(
    'group relative flex h-10 w-full shrink-0 items-center rounded-lg text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring',
    expanded ? 'gap-3 px-3' : 'justify-center',
    active ? 'font-semibold text-accent-strong' : 'font-medium text-fg-muted hover:bg-subtle hover:text-fg',
  )
}

interface RailEntryProps {
  icon: LucideIcon
  label: string
  expanded: boolean
  active?: boolean
  badge?: ReactNode
}

function RailEntryContent({ icon: Icon, label, expanded, badge }: RailEntryProps) {
  return (
    <>
      <span className="relative flex shrink-0">
        <Icon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
        {badge && !expanded && <span className="absolute -right-3 -top-2.5">{badge}</span>}
      </span>
      <span className={expanded ? 'min-w-0 flex-1 truncate text-left' : 'sr-only'}>{label}</span>
      {badge && expanded && badge}
    </>
  )
}

function withTooltip(expanded: boolean, label: string, node: ReactNode) {
  return expanded ? node : <Tooltip content={label} side="right">{node}</Tooltip>
}

function RailLink({ item, expanded, badge }: { item: NavItem; expanded: boolean; badge?: ReactNode }) {
  const { pathname } = useLocation()
  const active = isNavItemActive(item, pathname)
  return withTooltip(
    expanded,
    item.label,
    <NavLink to={item.path} aria-current={active ? 'page' : undefined} className={railItemClass(active, expanded)}>
      <RailEntryContent icon={item.icon} label={item.label} expanded={expanded} badge={badge} />
    </NavLink>,
  )
}

function RailButton({ icon, label, expanded, onClick }: { icon: LucideIcon; label: string; expanded: boolean; onClick: () => void }) {
  return withTooltip(
    expanded,
    label,
    <button type="button" onClick={onClick} className={railItemClass(false, expanded)}>
      <RailEntryContent icon={icon} label={label} expanded={expanded} />
    </button>,
  )
}

export interface RailAccount {
  name: string
  role: string
  onOpenSecurity: () => void
}

interface Props {
  role: string | undefined
  unreadCount: number
  brandName: string
  account: RailAccount | null
  theme: 'light' | 'dark'
  onToggleTheme: () => void
  onLogout: () => void
  onOpenSettings?: () => void
  onOpenIssueReport?: () => void
  /** El centro de notificaciones; recibe si el riel está expandido. */
  renderNotifications?: (expanded: boolean) => ReactNode
  /** Botones que solo aparecen a veces (versión nueva, primeros pasos). */
  extras?: ReactNode
}

/**
 * Navegación de tablet y escritorio. Reemplaza también a la barra superior:
 * logo arriba, vistas en grupos y, abajo, solo cuatro accesos fijos:
 * notificaciones, ayuda, configuración y la cuenta. Tema, cerrar sesión y
 * los reportes viven en los menús de ayuda y de cuenta: con un icono suelto
 * cada uno, el pie compacto llegó a nueve iconos (dos bichos iguales) y le
 * quitaba alto a las vistas, que terminaban con barra de desplazamiento.
 */
export function Sidebar({
  role, unreadCount, brandName, account, theme, onToggleTheme, onLogout, onOpenSettings, onOpenIssueReport, renderNotifications, extras,
}: Props) {
  const isWide = useMediaQuery(WIDE_QUERY)
  const [stored, setStored] = useState<boolean | null>(readStoredExpanded)
  const expanded = stored ?? isWide

  function toggleExpanded() {
    const next = !expanded
    setStored(next)
    try {
      localStorage.setItem(EXPANDED_KEY, String(next))
    } catch {
      // Sin almacenamiento el cambio vale para esta sesión.
    }
  }

  const items = visibleNavItems(role)
  const byGroup = (group: NavGroup) => items.filter((item) => item.group === group)
  const chatBadge = unreadCount > 0 ? <Counter value={unreadCount} /> : null
  const reportsItem = byGroup('footer').find((item) => item.path === '/reports')
  const toggleLabel = expanded ? 'Contraer menú' : 'Expandir menú'

  return (
    <aside
      className={cn(
        'relative flex shrink-0 flex-col border-r border-line bg-surface pt-safe transition-[width] duration-150 motion-reduce:transition-none',
        expanded ? 'w-54' : 'w-16',
      )}
    >
      <div className={cn('flex h-14 shrink-0 items-center gap-2.5', expanded ? 'px-4' : 'justify-center')}>
        <BrandLogo sizeClass="h-8 w-8" iconClass="h-4 w-4" />
        {expanded && <span className="min-w-0 truncate text-base font-semibold text-fg">{brandName}</span>}
      </div>
      {/* Expandir y contraer es un control del menú, no una acción: va en el
          borde, a la altura del logo, sin ocupar una fila. */}
      <Tooltip content={toggleLabel} side="right">
        <button
          type="button"
          onClick={toggleExpanded}
          aria-label={toggleLabel}
          aria-expanded={expanded}
          className="absolute -right-3 top-[calc(env(safe-area-inset-top)+1rem)] z-10 flex h-6 w-6 items-center justify-center rounded-full border border-line bg-surface text-fg-muted shadow-popover outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? <ChevronsLeft className="h-3.5 w-3.5" aria-hidden="true" /> : <ChevronsRight className="h-3.5 w-3.5" aria-hidden="true" />}
        </button>
      </Tooltip>

      <nav aria-label="Vista principal" className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 py-2">
        {byGroup('main').map((item) => (
          <RailLink key={item.path} item={item} expanded={expanded} badge={item.path === '/' ? chatBadge : undefined} />
        ))}
        {(['tools', 'settings'] as const).map((group) => {
          const groupItems = byGroup(group)
          if (groupItems.length === 0) return null
          return (
            <div key={group} role="group" aria-label={NAV_GROUP_LABELS[group]} className="mt-4 flex flex-col gap-0.5">
              {expanded ? (
                <p className="px-3 pb-1 text-xs font-semibold text-fg-muted">{NAV_GROUP_LABELS[group]}</p>
              ) : (
                <div aria-hidden="true" className="mx-auto mb-1 h-px w-8 bg-line" />
              )}
              {groupItems.map((item) => (
                <RailLink key={item.path} item={item} expanded={expanded} />
              ))}
            </div>
          )
        })}
      </nav>

      <div className="flex shrink-0 flex-col gap-0.5 border-t border-line px-2 py-2">
        {/* Herramientas (notificaciones, ayuda, configuración, primeros pasos).
            Expandido: una fila de iconos, con otra forma que las vistas para
            que no se lean como secciones de la app. Compacto: apiladas, como
            todo el riel. */}
        <div className={expanded ? 'flex items-center gap-1 px-1 pb-1' : 'flex flex-col gap-0.5'}>
          {renderNotifications?.(expanded)}
          {(onOpenIssueReport || reportsItem) && (
            <HelpMenu expanded={expanded} reportsItem={reportsItem} onOpenIssueReport={onOpenIssueReport} />
          )}
          {onOpenSettings && <SettingsEntry expanded={expanded} onOpenSettings={onOpenSettings} />}
          {extras && <div className={expanded ? 'ml-auto flex items-center gap-1' : 'flex flex-col items-center gap-0.5'}>{extras}</div>}
        </div>

        {account && <AccountMenu account={account} expanded={expanded} theme={theme} onToggleTheme={onToggleTheme} onLogout={onLogout} />}
      </div>
    </aside>
  )
}

const toolIconClass =
  'flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-fg-muted outline-none transition-colors hover:bg-subtle hover:text-fg focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-selected data-[state=open]:text-fg'

/** Ayuda y reportes: un menú, no dos iconos de bicho iguales en el pie. */
function HelpMenu({ expanded, reportsItem, onOpenIssueReport }: {
  expanded: boolean
  reportsItem?: NavItem
  onOpenIssueReport?: () => void
}) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  return (
    <DropdownMenu
      side={expanded ? 'top' : 'right'}
      align={expanded ? 'start' : 'end'}
      tooltip="Ayuda y reportes"
      tooltipSide={expanded ? 'top' : 'right'}
      trigger={
        expanded ? (
          <button type="button" aria-label="Ayuda y reportes" className={toolIconClass}>
            <CircleHelp className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className={railItemClass(Boolean(reportsItem && pathname === reportsItem.path), false)}>
            <RailEntryContent icon={CircleHelp} label="Ayuda y reportes" expanded={false} />
          </button>
        )
      }
    >
      {onOpenIssueReport && <DropdownMenuItem icon={Bug} onSelect={onOpenIssueReport}>Reportar un problema</DropdownMenuItem>}
      {reportsItem && <DropdownMenuItem icon={ClipboardList} onSelect={() => navigate(reportsItem.path)}>Ver mis reportes</DropdownMenuItem>}
    </DropdownMenu>
  )
}

function SettingsEntry({ expanded, onOpenSettings }: { expanded: boolean; onOpenSettings: () => void }) {
  if (!expanded) return <RailButton icon={SettingsIcon} label="Configuración" expanded={false} onClick={onOpenSettings} />
  return (
    <Tooltip content="Configuración" side="top">
      <button type="button" onClick={onOpenSettings} aria-label="Configuración" className={toolIconClass}>
        <SettingsIcon className="h-5 w-5" strokeWidth={1.75} aria-hidden="true" />
      </button>
    </Tooltip>
  )
}

/** La tarjeta del usuario abre seguridad, tema y cerrar sesión. */
function AccountMenu({ account, expanded, theme, onToggleTheme, onLogout }: {
  account: NonNullable<Props['account']>
  expanded: boolean
  theme: Props['theme']
  onToggleTheme: () => void
  onLogout: () => void
}) {
  return (
    <DropdownMenu
      side={expanded ? 'top' : 'right'}
      align="end"
      tooltip={expanded ? undefined : 'Tu cuenta'}
      tooltipSide="right"
      header={
        <>
          <p className="truncate text-sm font-semibold text-fg">{account.name}</p>
          <p className="truncate text-xs text-fg-muted">{account.role}</p>
        </>
      }
      trigger={
        <button
          type="button"
          aria-label="Menú de la cuenta"
          className={cn('mt-1 flex min-w-0 items-center gap-2.5 rounded-lg py-1.5 text-left outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-selected', expanded ? 'px-2' : 'justify-center p-1')}
        >
          <Avatar name={account.name} size="sm" />
          {/* Compacto: nombre y rol quedan para lectores de pantalla. */}
          <span className={expanded ? 'min-w-0 flex-1' : 'sr-only'}>
            <span className="block truncate text-sm font-medium text-fg">{account.name}</span>
            <span className="block truncate text-xs text-fg-muted">{account.role}</span>
          </span>
        </button>
      }
    >
      <DropdownMenuItem icon={ShieldCheck} onSelect={account.onOpenSecurity}>Acceso y seguridad</DropdownMenuItem>
      <DropdownMenuItem icon={theme === 'dark' ? Sun : Moon} onSelect={onToggleTheme}>
        {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
      </DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem icon={LogOut} onSelect={onLogout} danger>Cerrar sesión</DropdownMenuItem>
    </DropdownMenu>
  )
}
