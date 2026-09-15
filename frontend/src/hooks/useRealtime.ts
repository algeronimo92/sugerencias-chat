import { useEffect, useRef, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { parseChatSocketEvent } from '../realtime/socketEvents'
import { dispatchSocketEvent, type InternalMentionFn, type NotifyFn, type SocketHandlerContext } from '../realtime/socketHandlers'

export type { InternalMentionAlert } from '../realtime/socketHandlers'

function chatsSocketUrl(): string {
  const base = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'
  return `${base.replace(/^http/, 'ws')}/ws/chats`
}

const RECONNECT_DELAY_MS = 3_000
// Heartbeat: se manda un ping cada PING_INTERVAL_MS y, si no llega NINGÚN dato
// (ni el pong del server) en ACTIVITY_TIMEOUT_MS, el watchdog fuerza reconectar.
// Detecta las conexiones half-open que no disparan onclose.
const PING_INTERVAL_MS = 25_000
const WATCHDOG_INTERVAL_MS = 10_000
const ACTIVITY_TIMEOUT_MS = 40_000
const RESYNC_QUERY_KEYS = [['chats'], ['unread-count'], ['kanban'], ['dashboard'], ['notifications'], ['messages'], ['chat'], ['issue-reports']]
const socketListeners = new Set<() => void>()
let socketConnected = false

function setSocketConnected(value: boolean) {
  if (socketConnected === value) return
  socketConnected = value
  socketListeners.forEach(listener => listener())
}

export function useChatSocketConnected() {
  return useSyncExternalStore(
    listener => {
      socketListeners.add(listener)
      return () => {
        socketListeners.delete(listener)
      }
    },
    () => socketConnected,
    () => false,
  )
}

/** Escucha el websocket del backend y refresca chats/mensajes en cuanto hay
 * novedades. También dispara una notificación cuando el mensaje nuevo es de
 * un cliente y la aplicación está en segundo plano. Llamar una sola vez.
 * `activeChatId` se mantiene como parámetro por compatibilidad con las vistas;
 * useNotifications determina si la aplicación está realmente visible.
 * `notify` se recibe por parámetro (en vez de llamar a useNotifications acá
 * adentro) para que el estado de permiso de notificaciones quede en una
 * única instancia, compartida con el botón del header que lo controla. */
export function useChatUpdates(
  activeChatId: string | null = null,
  notify: NotifyFn = () => {},
  onInternalMention: InternalMentionFn = () => {},
) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const lastNotifiedMessageIdRef = useRef<string | null>(null)

  // El socket se conecta una sola vez (no queremos reconectar cada vez que
  // cambia el chat abierto o el permiso de notificaciones).
  void activeChatId
  const notifyRef = useRef(notify)
  const internalMentionRef = useRef(onInternalMention)

  // Las referencias se actualizan después del render, no durante. React puede
  // repetir o descartar trabajo de render, así que escribir ahí filtra valores
  // desde una UI que quizá nunca se confirmó. El handler del socket lee
  // `.current` cuando llega un mensaje —siempre después del commit—, de modo
  // que sigue viendo el callback vigente sin reconectar el socket.
  useEffect(() => {
    notifyRef.current = notify
    internalMentionRef.current = onInternalMention
  })

  useEffect(() => {
    let socket: WebSocket | null = null
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null
    let pingInterval: ReturnType<typeof setInterval> | null = null
    let watchdogInterval: ReturnType<typeof setInterval> | null = null
    let lastActivityAt = Date.now()
    let stopped = false

    const context: SocketHandlerContext = {
      queryClient,
      navigate,
      notify: (...args) => notifyRef.current(...args),
      onInternalMention: alert => internalMentionRef.current(alert),
      lastNotifiedMessageId: lastNotifiedMessageIdRef,
    }

    function clearHeartbeat() {
      if (pingInterval) { clearInterval(pingInterval); pingInterval = null }
      if (watchdogInterval) { clearInterval(watchdogInterval); watchdogInterval = null }
    }

    // Al (re)conectar se resincroniza todo lo que depende del tiempo real: los
    // broadcasts ocurridos mientras el socket estuvo caído se perdieron (se
    // enviaron a un socket muerto), así que hay que refetchear para no quedar
    // desactualizado hasta el próximo broadcast o un F5.
    function resync() {
      for (const queryKey of RESYNC_QUERY_KEYS) queryClient.invalidateQueries({ queryKey })
    }

    function connect() {
      socket = new WebSocket(chatsSocketUrl())

      socket.onopen = () => {
        setSocketConnected(true)
        lastActivityAt = Date.now()
        resync()
        // Sin heartbeat, una conexión half-open (tras dormir la laptop, cambiar
        // de red o un timeout de proxy) queda "abierta" para el navegador pero
        // muerta —onclose nunca dispara— y la pantalla se congela. El ping le da
        // señal de vida; el watchdog fuerza reconectar si dejó de llegar data.
        pingInterval = setInterval(() => {
          try { socket?.send(JSON.stringify({ type: 'ping' })) } catch { /* lo cierra el watchdog */ }
        }, PING_INTERVAL_MS)
        watchdogInterval = setInterval(() => {
          if (Date.now() - lastActivityAt > ACTIVITY_TIMEOUT_MS) socket?.close()
        }, WATCHDOG_INTERVAL_MS)
      }

      socket.onmessage = (event) => {
        lastActivityAt = Date.now()
        try {
          const payload = parseChatSocketEvent(event.data)
          if (payload) dispatchSocketEvent(payload, context)
        } catch {
          // Ignora payloads que no sean JSON válido
        }
      }

      socket.onclose = () => {
        setSocketConnected(false)
        clearHeartbeat()
        if (!stopped) {
          reconnectTimeout = setTimeout(connect, RECONNECT_DELAY_MS)
        }
      }
    }

    connect()

    return () => {
      stopped = true
      setSocketConnected(false)
      if (reconnectTimeout) clearTimeout(reconnectTimeout)
      clearHeartbeat()
      if (socket) {
        // Se sueltan los handlers antes de cerrar. close() no es inmediato, y
        // un onclose disparado ya desmontado volvería a tocar estado del hook
        // —o a programar una reconexión— sobre un componente que ya no existe.
        socket.onopen = null
        socket.onmessage = null
        socket.onclose = null
        socket.close()
      }
    }
  }, [queryClient, navigate])
}
