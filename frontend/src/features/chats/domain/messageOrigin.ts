/**
 * Quién o qué mandó un mensaje del negocio, para la pantalla.
 *
 * El backend deriva `origin` (persona desde la app, flujo, programado o fuera
 * de la app) y acá se decide cómo agrupar burbujas y qué etiqueta lleva la
 * primera de cada grupo. Incidente que lo motivó: una plantilla enviada a
 * mano era idéntica al primer envío de un flujo y, mirando el chat, nadie
 * podía saber si el flujo había arrancado.
 */

import type { Message } from '../../whatsapp/types'

export type MessageOrigin = NonNullable<Message['origin']>

/** Nombres de flujo por id de ejecución, para rotular un envío de flujo. */
export type FlowNamesByExecution = ReadonlyMap<number, string>

/**
 * Dos mensajes seguidos del mismo remitente se pegan en un grupo (sin cola ni
 * margen entre ellos) solo si además comparten origen: lo que mandó Grecia no
 * se mezcla con lo que mandó el flujo que ella lanzó un segundo después.
 */
export function originGroupKey(message: Pick<Message, 'sender' | 'origin'>): string {
  const origin = message.origin
  if (!origin) return message.sender
  const id = origin.kind === 'automation' ? origin.execution_id : origin.user_id
  return `${message.sender}|${origin.kind}|${id ?? ''}`
}

/**
 * Lo que dice la primera burbuja de un grupo del negocio. `null` cuando no
 * hay nada honesto que decir: un envío de la app anterior a la autoría, o un
 * mensaje del cliente.
 */
export function originLabel(origin: MessageOrigin | null | undefined, flowNames: FlowNamesByExecution): string | null {
  if (!origin) return null
  switch (origin.kind) {
    case 'user':
      return origin.user_name ?? null
    case 'automation': {
      const flowName = origin.execution_id != null ? flowNames.get(origin.execution_id) : undefined
      return flowName ? `Flujo ${flowName}` : 'Automatización'
    }
    case 'scheduled':
      return origin.user_name ? `Programado · ${origin.user_name}` : 'Programado'
    case 'echo':
      // No pasó por la app: el celular del negocio o un sistema anterior.
      // "Desde el celular" afirmaría más de lo que se sabe.
      return 'Fuera de la app'
    default:
      return null
  }
}
