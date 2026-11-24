import { BarChart3, BookOpen, Bug, CalendarClock, CalendarPlus, Columns3, FileText, FolderOpen, MessagesSquare, Plug, Send, Sparkles, Users, Workflow } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { can, type Permission, type Viewer } from '../shared/permissions'

export type NavItem = {
  path: string
  label: string
  icon: LucideIcon
  /** Se muestra a quien tenga alguno; vacío, a cualquiera con sesión. */
  permissions: readonly Permission[]
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
  { path: '/', label: 'Chats', icon: MessagesSquare, permissions: ['conversations.view'], group: 'main' },
  { path: '/kanban', label: 'Embudo', icon: Columns3, permissions: ['leads.view'], group: 'main' },
  { path: '/contacts', label: 'Contactos', icon: Users, permissions: ['contacts.view'], group: 'main' },
  { path: '/tasks', label: 'Tareas', icon: CalendarClock, permissions: ['tasks.use'], group: 'main' },
  { path: '/dashboard', label: 'Dashboard', icon: BarChart3, permissions: ['dashboard.view'], group: 'main' },
  { path: '/citas/nueva', label: 'Nueva Cita', icon: CalendarPlus, permissions: ['appointments.edit'], group: 'main' },
  { path: '/mis-flujos', label: 'Historial de envíos', icon: Send, permissions: ['automations.run'], group: 'tools' },
  { path: '/automations', label: 'Automatizaciones', icon: Workflow, permissions: ['automations.manage'], group: 'tools' },
  { path: '/templates', label: 'Plantillas', icon: FileText, permissions: ['templates.manage'], group: 'tools' },
  { path: '/media-library', label: 'Archivos', icon: FolderOpen, permissions: ['media_library.manage'], group: 'settings' },
  { path: '/catalogs', label: 'Catálogos', icon: BookOpen, permissions: ['catalogs.manage'], group: 'settings' },
  { path: '/integraciones', label: 'Integraciones', icon: Plug, permissions: ['settings.manage'], group: 'settings' },
  { path: '/ai-assistant', label: 'Asistente IA', icon: Sparkles, permissions: ['ai.configure'], group: 'settings' },
  { path: '/reports', label: 'Reportes', icon: Bug, permissions: [], group: 'footer' },
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
  // Una sección sigue activa en sus pantallas hijas: el editor de plantillas
  // vive en /templates/nueva y /templates/:id.
  return pathname === item.path || pathname.startsWith(`${item.path}/`)
}

export type { Viewer }

/**
 * Por defecto el dashboard lo leen quienes dirigen (admin y analista): compara
 * al equipo por nombre. Lo decide el permiso `dashboard.view`, que el negocio
 * puede darle también al vendedor.
 */
export function canSeeDashboard(viewer: Viewer): boolean {
  return can(viewer, 'dashboard.view')
}

/** Cada entrada se muestra según los permisos del rol, no por el nombre del
 * rol: si el negocio le da `catalogs.manage` al vendedor, le aparece Catálogos. */
export function visibleNavItems(viewer: Viewer): NavItem[] {
  if (!viewer) return []
  return NAV_ITEMS.filter((item) => item.permissions.length === 0 || can(viewer, ...item.permissions))
}

/** A dónde va "/" y cualquier ruta que el rol no puede ver: los chats, o el
 * dashboard para quien no los ve (por defecto, el analista). */
export function homePathFor(viewer: Viewer): string {
  if (!viewer || can(viewer, 'conversations.view')) return '/'
  return can(viewer, 'dashboard.view') ? '/dashboard' : '/reports'
}

export function roleLabel(role: string | undefined): string {
  if (role === 'admin') return 'Administrador'
  if (role === 'analista') return 'Analista'
  return 'Vendedor'
}
