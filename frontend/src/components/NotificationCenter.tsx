import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff, BellRing, CheckCheck, Loader2, MessageSquareLock, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { NotificationPermissionState } from '../hooks/useNotifications'
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotificationHistory } from '../hooks/useNotificationHistory'
import type { UserNotification } from '../types'
import { Button } from './ui'

interface Props {
  browserPermission: NotificationPermissionState
  onRequestBrowserPermission: () => void
  onNewNotification: (notification: {
    notificationId: number
    leadId: string
    authorName: string
    content: string
  }) => void
}

function notificationTime(value: string) {
  const date = new Date(value)
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'Ahora'
  if (seconds < 3600) return `Hace ${Math.floor(seconds / 60)} min`
  if (seconds < 86400) return `Hace ${Math.floor(seconds / 3600)} h`
  if (seconds < 604800) return `Hace ${Math.floor(seconds / 86400)} d`
  return date.toLocaleDateString()
}

export function NotificationCenter({ browserPermission, onRequestBrowserPermission, onNewNotification }: Props) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [unreadOnly, setUnreadOnly] = useState(false)
  const { data, isLoading, isError, error, refetch, isFetching, fetchNextPage, hasNextPage, isFetchingNextPage } = useNotificationHistory(unreadOnly)
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()
  const rootRef = useRef<HTMLDivElement>(null)
  const lastSurfacedIdRef = useRef(0)
  const unreadCount = data?.pages[0]?.unread_count ?? 0
  const notifications = data?.pages.flatMap(page => page.items) ?? []
  const latestUnread = notifications.find(notification => !notification.read_at)

  useEffect(() => {
    if (!latestUnread || latestUnread.id <= lastSurfacedIdRef.current || !latestUnread.lead_id) return
    lastSurfacedIdRef.current = latestUnread.id
    onNewNotification({
      notificationId: latestUnread.id,
      leadId: latestUnread.lead_id,
      authorName: typeof latestUnread.metadata?.author_name === 'string'
        ? latestUnread.metadata.author_name
        : 'Un usuario',
      content: latestUnread.body,
    })
  }, [latestUnread, onNewNotification])

  useEffect(() => {
    if (!open) return
    function closeOutside(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [open])

  function openNotification(notification: UserNotification) {
    if (!notification.read_at) markRead.mutate(notification.id)
    setOpen(false)
    if (notification.lead_id) navigate(`/chat/${notification.lead_id}`)
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen(current => !current)}
        aria-label="Centro de notificaciones"
        title="Notificaciones"
        className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-colors ${open ? 'bg-white/15 text-white dark:bg-white/10 dark:text-wa-text-dark' : 'text-white/80 hover:bg-white/10 hover:text-white dark:text-wa-muted-dark dark:hover:bg-white/5 dark:hover:text-wa-text-dark'}`}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-wa-primary-strong dark:ring-wa-head-dark">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-[80] flex max-h-[min(620px,calc(100vh-5rem))] w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-wa-border bg-white shadow-2xl dark:border-wa-border-dark dark:bg-wa-panel-dark">
          <header className="flex items-center justify-between gap-3 border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
            <div>
              <h2 className="text-sm font-semibold text-wa-text dark:text-white">Notificaciones</h2>
              <p className="text-[10px] text-wa-muted">{unreadCount ? `${unreadCount} sin leer` : 'Todo al día'}</p>
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button type="button" onClick={() => markAll.mutate()} disabled={markAll.isPending} title="Marcar todas como leídas" className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium text-wa-primary-strong hover:bg-green-50 disabled:opacity-40 dark:text-wa-primary dark:hover:bg-green-950/40">
                  {markAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />} Marcar todas
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-wa-muted hover:bg-wa-field dark:hover:bg-wa-head-dark"><X className="h-4 w-4" /></button>
            </div>
          </header>

          <div className="flex gap-1 border-b border-wa-border px-3 py-2 dark:border-wa-border-dark">
            <button type="button" onClick={() => setUnreadOnly(false)} className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${!unreadOnly ? 'bg-wa-panel-dark text-white dark:bg-wa-field dark:text-wa-text' : 'text-wa-muted hover:bg-wa-field dark:text-wa-muted-dark dark:hover:bg-wa-head-dark'}`}>Todas</button>
            <button type="button" onClick={() => setUnreadOnly(true)} className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${unreadOnly ? 'bg-wa-panel-dark text-white dark:bg-wa-field dark:text-wa-text' : 'text-wa-muted hover:bg-wa-field dark:text-wa-muted-dark dark:hover:bg-wa-head-dark'}`}>No leídas</button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-wa-muted" /></div>
            ) : isError ? (
              <div className="px-5 py-10 text-center">
                <BellOff className="mx-auto mb-2 h-7 w-7 text-red-300 dark:text-red-700" />
                <p className="text-sm font-medium text-red-600 dark:text-red-400">No se pudo cargar el historial</p>
                <p className="mt-1 text-[10px] text-wa-muted">{error instanceof Error ? error.message : 'Error de conexión'}</p>
                <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching} className="mt-3">
                  {isFetching && <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />}
                  Reintentar
                </Button>
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-5 py-14 text-center"><Bell className="mx-auto mb-2 h-7 w-7 text-gray-300 dark:text-gray-600" /><p className="text-sm text-wa-muted dark:text-wa-muted-dark">{unreadOnly ? 'No tenés notificaciones pendientes' : 'Todavía no tenés notificaciones'}</p></div>
            ) : (
              <>
              {notifications.map(notification => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => openNotification(notification)}
                  className={`flex w-full gap-3 border-b border-wa-border px-4 py-3 text-left transition-colors last:border-b-0 dark:border-wa-border-dark ${notification.read_at ? 'hover:bg-wa-hover dark:hover:bg-wa-head-dark/60' : 'bg-violet-50/70 hover:bg-violet-100/70 dark:bg-violet-950/20 dark:hover:bg-violet-950/35'}`}
                >
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    <MessageSquareLock className="h-4 w-4" />
                    {!notification.read_at && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-violet-600 ring-2 ring-white dark:ring-gray-900" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-xs ${notification.read_at ? 'font-medium text-gray-700 dark:text-gray-300' : 'font-semibold text-wa-text dark:text-white'}`}>{notification.title}</span>
                    <span className="mt-0.5 block line-clamp-2 text-[11px] leading-relaxed text-wa-muted dark:text-wa-muted-dark">{notification.body}</span>
                    <span className="mt-1 block text-[10px] text-wa-muted">{notificationTime(notification.created_at)}</span>
                  </span>
                </button>
              ))}
              {hasNextPage && (
                <div className="p-3 text-center">
                  <button type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium text-wa-primary-strong hover:bg-green-50 disabled:opacity-40 dark:text-wa-primary dark:hover:bg-green-950/40">
                    {isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {isFetchingNextPage ? 'Cargando...' : 'Cargar notificaciones anteriores'}
                  </button>
                </div>
              )}
              </>
            )}
          </div>

          <footer className="border-t border-wa-border bg-wa-hover px-4 py-2.5 dark:border-wa-border-dark dark:bg-wa-panel-dark">
            {browserPermission === 'default' && (
              <button type="button" onClick={onRequestBrowserPermission} className="flex w-full items-center justify-center gap-1.5 text-[11px] font-medium text-wa-primary-strong hover:text-green-800 dark:text-wa-primary"><BellRing className="h-3.5 w-3.5" /> Activar también avisos del navegador</button>
            )}
            {browserPermission === 'granted' && <p className="flex items-center justify-center gap-1.5 text-[10px] text-wa-primary-strong dark:text-wa-primary"><BellRing className="h-3.5 w-3.5" /> Avisos del navegador activados</p>}
            {browserPermission === 'denied' && <p className="flex items-center justify-center gap-1.5 text-[10px] text-wa-muted"><BellOff className="h-3.5 w-3.5" /> Avisos bloqueados por el navegador</p>}
            {browserPermission === 'unsupported' && <p className="text-center text-[10px] text-wa-muted">Este navegador no admite avisos de escritorio</p>}
          </footer>
        </div>
      )}
    </div>
  )
}
