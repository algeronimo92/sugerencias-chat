import { BarChart3, BookOpen, Bug, CalendarClock, CalendarPlus, Columns3, FileText, FolderOpen, MessagesSquare, Workflow } from 'lucide-react'
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
  /** Ancho de Tailwind a partir del cual se muestra el texto en la barra superior. */
  labelFrom: 'sm' | 'md' | 'lg' | 'xl'
}

export const NAV_ITEMS: readonly NavItem[] = [
  { path: '/', label: 'Chats', icon: MessagesSquare, adminOnly: false, primary: true, labelFrom: 'sm' },
  { path: '/kanban', label: 'Kanban', icon: Columns3, adminOnly: false, primary: true, labelFrom: 'sm' },
  { path: '/tasks', label: 'Tareas', icon: CalendarClock, adminOnly: false, primary: true, labelFrom: 'md' },
  { path: '/citas/nueva', label: 'Nueva Cita', icon: CalendarPlus, adminOnly: false, primary: false, labelFrom: 'lg' },
  { path: '/reports', label: 'Reportes', icon: Bug, adminOnly: false, primary: false, labelFrom: 'xl' },
  { path: '/dashboard', label: 'Dashboard', icon: BarChart3, adminOnly: true, primary: false, labelFrom: 'lg' },
  { path: '/automations', label: 'Automatizaciones', icon: Workflow, adminOnly: true, primary: false, labelFrom: 'xl' },
  { path: '/templates', label: 'Plantillas', icon: FileText, adminOnly: true, primary: false, labelFrom: 'lg' },
  { path: '/media-library', label: 'Archivos', icon: FolderOpen, adminOnly: true, primary: false, labelFrom: 'xl' },
  { path: '/catalogs', label: 'Catálogos', icon: BookOpen, adminOnly: true, primary: false, labelFrom: 'xl' },
]

/** Los chats tienen su propia ruta de detalle, así que no basta con comparar. */
export function isNavItemActive(item: NavItem, pathname: string): boolean {
  if (item.path === '/') return pathname === '/' || pathname.startsWith('/chat/')
  return pathname === item.path
}

export function visibleNavItems(isAdmin: boolean): NavItem[] {
  return NAV_ITEMS.filter((item) => !item.adminOnly || isAdmin)
}
