import { BarChart3, BookOpen, Bug, CalendarClock, CalendarPlus, Columns3, FileText, FolderOpen, MessagesSquare, Plug, Send, Sparkles, Users, Workflow } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type NavItem = {
  path: string
  label: string
  icon: LucideIcon
  adminOnly: boolean
  /**
   * Dónde va en el riel de escritorio (doc 18 §7.1): de 14 entradas planas a
   * grupos. `footer` queda fijo abajo con la cuenta. Las rutas no cambian;
   * solo dónde se muestran.
   */
  group: NavGroup
}

export type NavGroup = 'main' | 'tools' | 'settings' | 'footer'

export const NAV_GROUP_LABELS: Record<Exclude<NavGroup, 'main' | 'footer'>, string> = {
  tools: 'Herramientas',
  settings: 'Configuración',
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/', label: 'Chats', icon: MessagesSquare, adminOnly: false, group: 'main' },
  { path: '/kanban', label: 'Embudo', icon: Columns3, adminOnly: false, group: 'main' },
  { path: '/contacts', label: 'Contactos', icon: Users, adminOnly: false, group: 'main' },
  { path: '/tasks', label: 'Tareas', icon: CalendarClock, adminOnly: false, group: 'main' },
  { path: '/dashboard', label: 'Dashboard', icon: BarChart3, adminOnly: false, group: 'main' },
  { path: '/citas/nueva', label: 'Nueva Cita', icon: CalendarPlus, adminOnly: false, group: 'main' },
  { path: '/mis-flujos', label: 'Flujos enviados', icon: Send, adminOnly: false, group: 'tools' },
  { path: '/automations', label: 'Automatizaciones', icon: Workflow, adminOnly: true, group: 'tools' },
  { path: '/templates', label: 'Plantillas', icon: FileText, adminOnly: true, group: 'tools' },
  { path: '/media-library', label: 'Archivos', icon: FolderOpen, adminOnly: true, group: 'settings' },
  { path: '/catalogs', label: 'Catálogos', icon: BookOpen, adminOnly: true, group: 'settings' },
  { path: '/integraciones', label: 'Integraciones', icon: Plug, adminOnly: true, group: 'settings' },
  { path: '/ai-assistant', label: 'Asistente IA', icon: Sparkles, adminOnly: true, group: 'settings' },
  { path: '/reports', label: 'Reportes', icon: Bug, adminOnly: false, group: 'footer' },
]

/**
 * Pestañas de la barra inferior del celular, en este orden; el resto vive
 * detrás de "Más". Con cinco pestañas o más los objetivos táctiles quedan por
 * debajo del mínimo cómodo para el pulgar. Son las vistas de trabajo diario:
 * Reportes y Embudo pasan a "Más" (decisión 7 del doc 18).
 */
export const MOBILE_TAB_PATHS: readonly string[] = ['/', '/tasks', '/contacts']

/** Los chats tienen su propia ruta de detalle, así que no basta con comparar. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.path === '/') return pathname === '/' || pathname.startsWith('/chat/')
  return pathname === item.path
}

/**
 * El dashboard compara al equipo por nombre, así que por ahora lo leen solo
 * quienes dirigen: admin y analista. El backend le niega la ruta al vendedor
 * (app/modules/leads/dashboard/api.py); esto solo evita mostrarle una entrada
 * que termina en error.
 */
export function canSeeDashboard(role: string | undefined): boolean {
  return role === 'admin' || role === 'analista'
}

/** `role` es el de la sesión tal como llega del backend (texto). */
export function visibleNavItems(role: string | undefined): NavItem[] {
  // El analista existe para mirar el dashboard: ninguna otra vista le sirve y
  // el backend se las niega (app/modules/auth/role_policy.py).
  if (role === 'analista') return NAV_ITEMS.filter((item) => item.path === '/dashboard')
  return NAV_ITEMS.filter((item) => (
    (!item.adminOnly || role === 'admin') && (item.path !== '/dashboard' || canSeeDashboard(role))
  ))
}

/** A dónde va "/" y cualquier ruta que el rol no puede ver. */
export function homePathFor(role: string | undefined): string {
  return role === 'analista' ? '/dashboard' : '/'
}

export function roleLabel(role: string | undefined): string {
  if (role === 'admin') return 'Administrador'
  if (role === 'analista') return 'Analista'
  return 'Vendedor'
}
