import { MessageSquareLock } from 'lucide-react'
import type { UserNotification } from '../types'
import { ServiceWindowOverrideAction } from './ServiceWindowOverrideAction'

function notificationTime(value: string) {
  const date = new Date(value)
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  if (seconds < 60) return 'Ahora'
  if (seconds < 3600) return `Hace ${Math.floor(seconds / 60)} min`
  if (seconds < 86400) return `Hace ${Math.floor(seconds / 3600)} h`
  if (seconds < 604800) return `Hace ${Math.floor(seconds / 86400)} d`
  return date.toLocaleDateString()
}

interface Props {
  notification: UserNotification
  isAdmin: boolean
  onOpen: (notification: UserNotification) => void
}

export function NotificationRow({ notification, isAdmin, onOpen }: Props) {
  const isRead = !!notification.read_at
  return (
    <div
      className={`border-b border-wa-border transition-colors last:border-b-0 dark:border-wa-border-dark ${isRead ? 'hover:bg-wa-hover dark:hover:bg-wa-head-dark/60' : 'bg-violet-50/70 hover:bg-violet-100/70 dark:bg-violet-950/20 dark:hover:bg-violet-950/35'}`}
    >
      <button
        type="button"
        onClick={() => onOpen(notification)}
        className="flex w-full gap-3 px-4 py-3 text-left"
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
          <MessageSquareLock className="h-4 w-4" />
          {!isRead && <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-violet-600 ring-2 ring-white dark:ring-gray-900" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className={`block text-xs ${isRead ? 'font-medium text-gray-700 dark:text-gray-300' : 'font-semibold text-wa-text dark:text-white'}`}>{notification.title}</span>
          <span className="mt-0.5 block line-clamp-2 text-[11px] leading-relaxed text-wa-muted dark:text-wa-muted-dark">{notification.body}</span>
          <span className="mt-1 block text-[10px] text-wa-muted">{notificationTime(notification.created_at)}</span>
        </span>
      </button>
      <ServiceWindowOverrideAction notification={notification} isAdmin={isAdmin} />
    </div>
  )
}
