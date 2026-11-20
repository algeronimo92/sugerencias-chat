import { CalendarX, Copy, Eye, GitMerge, Loader2, Mail, Trash2 } from 'lucide-react'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useMe } from '../../auth/public/queries'
import { useDeleteLead, useMarkNoShow } from '../../leads/public/queries'
import { displayName } from '../../leads/public/chat'
import type { Chat } from '../../leads/types'

// Diálogos que solo se abren a pedido: fuera del bundle inicial.
const MergeLeadDialog = lazy(() => import('../../leads/public/MergeLeadDialog').then(m => ({ default: m.MergeLeadDialog })))

export interface MenuPosition { x: number; y: number }

interface Props {
  chat: Chat
  /** Dónde se abrió el menú (null = cerrado). */
  position: MenuPosition | null
  onPositionChange: (position: MenuPosition | null) => void
  onPreview: () => void
  onMarkUnread: () => void
  isMarkingUnread: boolean
}

const ITEM_CLASS = 'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-wa-text hover:bg-wa-hover disabled:opacity-50 dark:text-wa-text-dark dark:hover:bg-wa-active-dark'
const ICON_CLASS = 'h-4 w-4 text-wa-muted dark:text-wa-muted-dark'

/** Menú contextual de una fila de la lista de chats, con los diálogos que
 * abre. Los diálogos viven aquí y no dentro del menú: el menú se cierra al
 * elegir la opción y el diálogo tiene que seguir montado. */
export function ChatItemMenu({ chat, position, onPositionChange, onPreview, onMarkUnread, isMarkingUnread }: Props) {
  const menuRef = useRef<HTMLDivElement>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showMergeDialog, setShowMergeDialog] = useState(false)
  const navigate = useNavigate()
  const { chatId: openChatId } = useParams<{ chatId?: string }>()
  const { data: me } = useMe()
  const isAdmin = me?.role === 'admin'
  const { mutate: markNoShow, isPending: isMarkingNoShow } = useMarkNoShow(chat.chat_id)
  const { mutate: deleteLead, isPending: isDeleting } = useDeleteLead()

  function close() {
    onPositionChange(null)
  }

  function handleCopyPhone() {
    if (!chat.phone) return
    void navigator.clipboard.writeText(chat.phone).then(
      () => toast.success('Teléfono copiado'),
      () => toast.error('No se pudo copiar el teléfono'),
    )
  }

  function handleMarkNoShow() {
    if (isMarkingNoShow) return
    markNoShow(undefined, { onError: (err) => toast.error(extractErrorMessage(err)) })
  }

  function handleDelete() {
    deleteLead(chat.chat_id, {
      onSuccess: () => {
        toast.success(`${displayName(chat)} eliminado`)
        if (openChatId === chat.chat_id) navigate('/')
      },
      onError: (err) => toast.error(extractErrorMessage(err)),
    })
  }

  const isOpen = position !== null
  useEffect(() => {
    if (!isOpen) return
    const closeMenu = () => onPositionChange(null)
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') closeMenu() }
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    window.addEventListener('keydown', closeOnEscape)
    document.addEventListener('pointerdown', closeMenu)
    return () => {
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
      window.removeEventListener('keydown', closeOnEscape)
      document.removeEventListener('pointerdown', closeMenu)
    }
  }, [isOpen, onPositionChange])

  // El menú creció (copiar teléfono, no-show, fusionar, eliminar): con un
  // lead abierto cerca del borde inferior, la altura fija de antes dejaba
  // las últimas opciones tapadas por el borde de la ventana. Se mide el
  // tamaño real ya renderizado y se reubica antes del primer paint, así que
  // no se ve el salto.
  useLayoutEffect(() => {
    if (!position || !menuRef.current) return
    const rect = menuRef.current.getBoundingClientRect()
    const clampedX = Math.max(8, Math.min(position.x, window.innerWidth - rect.width - 8))
    const clampedY = Math.max(8, Math.min(position.y, window.innerHeight - rect.height - 8))
    if (clampedX !== position.x || clampedY !== position.y) {
      onPositionChange({ x: clampedX, y: clampedY })
    }
  }, [position, onPositionChange])

  return (
    <>
      {position && createPortal(
        <div
          ref={menuRef}
          role="menu"
          aria-label={`Acciones para ${displayName(chat)}`}
          style={{ left: position.x, top: position.y }}
          className="fixed z-[100] max-h-[calc(100vh-16px)] w-52 overflow-y-auto rounded-xl border border-wa-border bg-white p-1.5 shadow-2xl dark:border-wa-border-dark dark:bg-wa-head-dark"
          onPointerDown={event => event.stopPropagation()}
        >
          <button type="button" role="menuitem" onClick={() => { close(); onPreview() }} className={ITEM_CLASS}>
            <Eye className={ICON_CLASS} /> Vista rápida
          </button>
          {chat.unread_count === 0 && chat.last_customer_message_at && (
            <button
              type="button"
              role="menuitem"
              disabled={isMarkingUnread}
              onClick={() => { close(); onMarkUnread() }}
              className={ITEM_CLASS}
            >
              {isMarkingUnread ? <Loader2 className="h-4 w-4 animate-spin text-wa-muted" /> : <Mail className={ICON_CLASS} />}
              Marcar como no leído
            </button>
          )}
          {chat.phone && (
            <button type="button" role="menuitem" onClick={() => { close(); handleCopyPhone() }} className={ITEM_CLASS}>
              <Copy className={ICON_CLASS} /> Copiar teléfono
            </button>
          )}
          {chat.proxima_cita && (
            <button
              type="button"
              role="menuitem"
              disabled={isMarkingNoShow}
              onClick={() => { close(); handleMarkNoShow() }}
              className={ITEM_CLASS}
            >
              {isMarkingNoShow ? <Loader2 className="h-4 w-4 animate-spin text-wa-muted" /> : <CalendarX className={ICON_CLASS} />}
              Marcar no-show
            </button>
          )}
          {isAdmin && (
            <>
              <div className="my-1.5 border-t border-wa-border dark:border-wa-border-dark" />
              <button type="button" role="menuitem" onClick={() => { close(); setShowMergeDialog(true) }} className={ITEM_CLASS}>
                <GitMerge className={ICON_CLASS} /> Fusionar con...
              </button>
              <button
                type="button"
                role="menuitem"
                disabled={isDeleting}
                onClick={() => { close(); setShowDeleteConfirm(true) }}
                className="flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 disabled:opacity-50 dark:text-red-400 dark:hover:bg-red-950/40"
              >
                {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Eliminar lead
              </button>
            </>
          )}
        </div>,
        document.body,
      )}
      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="Eliminar lead"
        description={`Se borra ${displayName(chat)} junto con todo su historial de mensajes, tareas y notas. No se puede deshacer.`}
        confirmLabel="Eliminar"
        onConfirm={handleDelete}
      />
      <Suspense fallback={null}>
        {showMergeDialog && (
          <MergeLeadDialog chat={chat} onClose={() => setShowMergeDialog(false)} />
        )}
      </Suspense>
    </>
  )
}
