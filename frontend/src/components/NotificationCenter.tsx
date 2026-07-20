import { useEffect, useRef, useState } from 'react'
import { Bell, BellOff, BellRing, CheckCheck, Loader2, MessageSquareLock, X } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import type { NotificationPermissionState } from '../hooks/useNotifications'
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotificationHistory } from '../hooks/useNotificationHistory'
import type { UserNotification } from '../types'

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
  const { data, isLoading, isError, error, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } = useNotificationHistory(unreadOnly)
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
        className={`relative flex h-7 w-7 items-center justify-center rounded-md transition-colors ${open ? 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-100' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-200'}`}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white ring-2 ring-white dark:ring-gray-900">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-9 z-[80] flex max-h-[min(620px,calc(100vh-5rem))] w-96 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900">
          <header className="flex items-center justify-between gap-3 border-b border-gray-200 px-4 py-3 dark:border-gray-800">
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">Notificaciones</h2>
              <p className="text-[10px] text-gray-400">{unreadCount ? `${unreadCount} sin leer` : 'Todo al día'}</p>
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <button type="button" onClick={() => markAll.mutate()} disabled={markAll.isPending} title="Marcar todas como leídas" className="flex items-center gap-1 rounded-md px-2 py-1.5 text-[10px] font-medium text-green-700 hover:bg-green-50 disabled:opacity-40 dark:text-green-400 dark:hover:bg-green-950/40">
                  {markAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />} Marcar todas
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"><X className="h-4 w-4" /></button>
            </div>
          </header>

          <div className="flex gap-1 border-b border-gray-100 px-3 py-2 dark:border-gray-800">
            <button type="button" onClick={() => setUnreadOnly(false)} className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${!unreadOnly ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}>Todas</button>
            <button type="button" onClick={() => setUnreadOnly(true)} className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${unreadOnly ? 'bg-gray-900 text-white dark:bg-gray-100 dark:text-gray-900' : 'text-gray-500 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}>No leídas</button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {isLoading ? (
              <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-gray-400" /></div>
            ) : isError ? (
              <div className="px-5 py-10 text-center">
                <BellOff className="mx-auto mb-2 h-7 w-7 text-red-300 dark:text-red-700" />
                <p className="text-sm font-medium text-red-600 dark:text-red-400">No se pudo cargar el historial</p>
                <p className="mt-1 text-[10px] text-gray-400">{error instanceof Error ? error.message : 'Error de conexión'}</p>
                <button type="button" onClick={() => refetch()} className="mt-3 rounded-md bg-gray-900 px-3 py-1.5 text-[11px] font-medium text-white dark:bg-gray-100 dark:text-gray-900">Reintentar</button>
              </div>
            ) : notifications.length === 0 ? (
              <div className="px-5 py-14 text-center"><Bell className="mx-auto mb-2 h-7 w-7 text-gray-300 dark:text-gray-600" /><p className="text-sm text-gray-500 dark:text-gray-400">{unreadOnly ? 'No tienes notificaciones pendientes' : 'Aún no tienes notificaciones'}</p></div>
            ) : (
              <>
              {notifications.map(notification => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => openNotification(notification)}
                  className={`flex w-full gap-3 border-b border-gray-100 px-4 py-3 text-left transition-colors last:border-b-0 dark:border-gray-800 ${notification.read_at ? 'hover:bg-gray-50 dark:hover:bg-gray-800/60' : 'bg-violet-50/70 hover:bg-violet-100/70 dark:bg-violet-950/20 dark:hover:bg-violet-950/35'}`}
                >
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                    <MessageSquareLock className="h-4 w-4" />
                    {!notification.read_at && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-violet-600 ring-2 ring-white dark:ring-gray-900" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-xs ${notification.read_at ? 'font-medium text-gray-700 dark:text-gray-300' : 'font-semibold text-gray-900 dark:text-white'}`}>{notification.title}</span>
                    <span className="mt-0.5 block line-clamp-2 text-[11px] leading-relaxed text-gray-500 dark:text-gray-400">{notification.body}</span>
                    <span className="mt-1 block text-[10px] text-gray-400">{notificationTime(notification.created_at)}</span>
                  </span>
                </button>
              ))}
              {hasNextPage && (
                <div className="p-3 text-center">
                  <button type="button" onClick={() => fetchNextPage()} disabled={isFetchingNextPage} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium text-green-700 hover:bg-green-50 disabled:opacity-40 dark:text-green-400 dark:hover:bg-green-950/40">
                    {isFetchingNextPage && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    {isFetchingNextPage ? 'Cargando...' : 'Cargar notificaciones anteriores'}
                  </button>
                </div>
              )}
              </>
            )}
          </div>

          <footer className="border-t border-gray-200 bg-gray-50 px-4 py-2.5 dark:border-gray-800 dark:bg-gray-900">
            {browserPermission === 'default' && (
              <button type="button" onClick={onRequestBrowserPermission} className="flex w-full items-center justify-center gap-1.5 text-[11px] font-medium text-green-700 hover:text-green-800 dark:text-green-400"><BellRing className="h-3.5 w-3.5" /> Activar también avisos del navegador</button>
            )}
            {browserPermission === 'granted' && <p className="flex items-center justify-center gap-1.5 text-[10px] text-green-600 dark:text-green-500"><BellRing className="h-3.5 w-3.5" /> Avisos del navegador activados</p>}
            {browserPermission === 'denied' && <p className="flex items-center justify-center gap-1.5 text-[10px] text-gray-400"><BellOff className="h-3.5 w-3.5" /> Avisos bloqueados por el navegador</p>}
            {browserPermission === 'unsupported' && <p className="text-center text-[10px] text-gray-400">Este navegador no admite avisos de escritorio</p>}
          </footer>
        </div>
      )}
    </div>
  )
}
