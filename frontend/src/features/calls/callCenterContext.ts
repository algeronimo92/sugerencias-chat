import { createContext, useContext } from 'react'

import type { CallSession } from './domain/callSession'
import type { Call } from './types'

/** Cómo le llega al proveedor un fin de llamada desde el tiempo real, que
 *  vive fuera del árbol de React. */
export const CALL_ENDED_EVENT = 'crm:call-ended'

export interface CallCenter {
  enabled: boolean
  ringing: Call[]
  session: CallSession
  answer: (call: Call) => void
  dismiss: (call: Call) => void
  hangUp: () => void
  toggleMute: () => void
  clearEnded: () => void
}

export const CallCenterContext = createContext<CallCenter | null>(null)

export function useCallCenter(): CallCenter {
  const value = useContext(CallCenterContext)
  if (!value) throw new Error('useCallCenter se usa dentro de CallCenterProvider')
  return value
}
