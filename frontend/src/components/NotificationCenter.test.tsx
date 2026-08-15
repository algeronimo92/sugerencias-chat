/**
 * La autorización del admin dentro de la alerta: cuando una automatización no
 * pudo escribirle al cliente porque la ventana de 24 h estaba cerrada, el
 * admin la habilita desde la notificación misma y la ejecución se reprograma
 * con ese permiso. El resto de los avisos no ofrecen nada.
 */

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NotificationCenter } from './NotificationCenter'
import type { UserNotification } from '../types'

const mocks = vi.hoisted(() => ({
  retry: vi.fn(),
  role: 'admin',
  items: [] as UserNotification[],
}))

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('../hooks/useAuth', () => ({ useMe: () => ({ data: { id: 1, role: mocks.role } }) }))
vi.mock('../hooks/useAutomations', () => ({
  useRetryExecution: () => ({ mutate: mocks.retry, isPending: false }),
}))
vi.mock('../hooks/useNotificationHistory', () => ({
  useNotificationHistory: () => ({
    data: { pages: [{ items: mocks.items, unread_count: 1, has_more: false }] },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
    fetchNextPage: vi.fn(),
    hasNextPage: false,
    isFetchingNextPage: false,
  }),
  useMarkNotificationRead: () => ({ mutate: vi.fn(), isPending: false }),
  useMarkAllNotificationsRead: () => ({ mutate: vi.fn(), isPending: false }),
}))

function notification(metadata: UserNotification['metadata']): UserNotification {
  return {
    id: 9,
    notification_type: 'automation',
    title: 'Automatización con error: Hollywood peel',
    body: 'No se envió WhatsApp porque la ventana de 24 horas está cerrada',
    lead_id: null,
    source_id: 'execution-failed:42',
    metadata,
    read_at: null,
    created_at: new Date().toISOString(),
  }
}

async function open() {
  const user = userEvent.setup()
  render(
    <NotificationCenter
      browserPermission="granted"
      onRequestBrowserPermission={vi.fn()}
      onNewNotification={vi.fn()}
    />,
  )
  await user.click(screen.getByRole('button', { name: 'Centro de notificaciones' }))
  return user
}

describe('autorización de la ventana de 24 h', () => {
  beforeEach(() => {
    mocks.retry.mockReset()
    mocks.role = 'admin'
    mocks.items = []
  })

  it('reintenta la ejecución con la autorización del admin', async () => {
    mocks.items = [notification({ error_code: 'service_window_closed', automation_execution_id: 42 })]
    const user = await open()

    await user.click(screen.getByRole('button', { name: /Autorizar y reintentar/ }))

    expect(mocks.retry).toHaveBeenCalledWith(
      { id: 42, ignoreServiceWindow: true },
      expect.any(Object),
    )
  })

  it('confirma en la alerta que quedó autorizada', async () => {
    mocks.items = [notification({ error_code: 'service_window_closed', automation_execution_id: 42 })]
    mocks.retry.mockImplementation((_vars, { onSuccess }) => onSuccess())
    const user = await open()

    await user.click(screen.getByRole('button', { name: /Autorizar y reintentar/ }))

    expect(screen.getByText(/se reintenta ignorando la ventana/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Autorizar y reintentar/ })).toBeNull()
  })

  it('no ofrece autorizar cuando el fallo fue por otro motivo', async () => {
    mocks.items = [notification({ automation_execution_id: 42 })]
    await open()

    expect(screen.queryByRole('button', { name: /Autorizar y reintentar/ })).toBeNull()
  })

  it('no ofrece autorizar a un vendedor', async () => {
    mocks.role = 'vendedor'
    mocks.items = [notification({ error_code: 'service_window_closed', automation_execution_id: 42 })]
    await open()

    expect(screen.queryByRole('button', { name: /Autorizar y reintentar/ })).toBeNull()
  })
})
