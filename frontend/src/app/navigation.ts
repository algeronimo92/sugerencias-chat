import { BarChart3, BookOpen, Bug, CalendarClock, CalendarPlus, Columns3, FileText, FolderOpen, MessagesSquare, Plug, Send, Sparkles, Workflow } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type NavItem = {
  path: string
  label: string
  icon: LucideIcon
  adminOnly: boolean
  /**
   * En móvil solo las principales entran en la barra inferior; el resto vive
   * detrás del botón "Más". Con cinco pestañas o más los objetivos táctiles
   * quedan por debajo del mínimo cómodo para el pulgar.
   */
  primary: boolean
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/', label: 'Chats', icon: MessagesSquare, adminOnly: false, primary: true },
  { path: '/kanban', label: 'Kanban', icon: Columns3, adminOnly: false, primary: false },
  { path: '/tasks', label: 'Tareas', icon: CalendarClock, adminOnly: false, primary: true },
  { path: '/citas/nueva', label: 'Nueva Cita', icon: CalendarPlus, adminOnly: false, primary: false },
  { path: '/reports', label: 'Reportes', icon: Bug, adminOnly: false, primary: true },
  { path: '/mis-flujos', label: 'Flujos enviados', icon: Send, adminOnly: false, primary: false },
  { path: '/dashboard', label: 'Dashboard', icon: BarChart3, adminOnly: false, primary: false },
  { path: '/automations', label: 'Automatizaciones', icon: Workflow, adminOnly: true, primary: false },
  { path: '/templates', label: 'Plantillas', icon: FileText, adminOnly: true, primary: false },
  { path: '/media-library', label: 'Archivos', icon: FolderOpen, adminOnly: true, primary: false },
  { path: '/catalogs', label: 'Catálogos', icon: BookOpen, adminOnly: true, primary: false },
  { path: '/integraciones', label: 'Integraciones', icon: Plug, adminOnly: true, primary: false },
  { path: '/ai-assistant', label: 'Asistente IA', icon: Sparkles, adminOnly: true, primary: false },
]

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
