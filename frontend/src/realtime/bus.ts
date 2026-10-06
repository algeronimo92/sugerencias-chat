/**
 * El tiempo real como bus de eventos.
 *
 * `realtime/` conecta el WebSocket, valida cada evento (socketEvents.ts) y lo
 * reparte; no sabe qué datos tiene cada pantalla. Cada feature declara un
 * módulo (`RealtimeModule`) con lo que hace ante cada evento y las claves que
 * hay que releer al reconectar, y `app/` arma el bus con todos ellos, como el
 * backend registra sus suscriptores.
 *
 * Un mismo evento puede tener handlers en varias features: `chats_updated`
 * refresca la bandeja (chats), la actividad y el kanban (leads) y la
 * sugerencia (ai), cada una con sus propias claves.
 */

import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { NavigateFunction } from 'react-router-dom'

import type { ChatSocketEvent, RealtimeEventType, SocketEventOf } from './socketEvents'

export interface NotifyOptions {
  /** Avisar aunque la app esté a la vista. */
  force?: boolean
  /** Un aviso nuevo con el mismo tag reemplaza al anterior. */
  tag?: string
}

export type NotifyFn = (title: string, body: string, onClick: () => void, options?: NotifyOptions) => void

export interface InternalMentionAlert {
  notificationId: number
  leadId: string
  authorName: string
  content: string
}

export type InternalMentionFn = (alert: InternalMentionAlert) => void

/** Lo que recibe cada handler: la caché, la navegación y los avisos. */
export interface RealtimeContext {
  queryClient: QueryClient
  navigate: NavigateFunction
  notify: NotifyFn
  onInternalMention: InternalMentionFn
}

export type RealtimeHandler<K extends RealtimeEventType> = (event: SocketEventOf<K>, context: RealtimeContext) => void

export type RealtimeHandlers = { [K in RealtimeEventType]?: RealtimeHandler<K> }

/** Lo que una feature aporta al tiempo real. */
export interface RealtimeModule {
  handlers: RealtimeHandlers
  /** Claves a releer al (re)conectar: los avisos que llegaron con el socket
   * caído se perdieron. */
  resync?: readonly QueryKey[]
}

export interface RealtimeBus {
  dispatch(event: ChatSocketEvent, context: RealtimeContext): void
  resyncKeys: readonly QueryKey[]
}

export function createRealtimeBus(modules: readonly RealtimeModule[]): RealtimeBus {
  return {
    dispatch(event, context) {
      for (const module of modules) {
        const handler = module.handlers[event.type] as ((event: ChatSocketEvent, context: RealtimeContext) => void) | undefined
        handler?.(event, context)
      }
    },
    resyncKeys: modules.flatMap(module => module.resync ?? []),
  }
}

/** Marca como desactualizadas las claves dadas (y sus variantes). */
export function invalidate(queryClient: QueryClient, ...queryKeys: QueryKey[]) {
  for (const queryKey of queryKeys) void queryClient.invalidateQueries({ queryKey })
}
