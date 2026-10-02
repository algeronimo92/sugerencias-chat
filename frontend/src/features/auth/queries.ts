import { useMutation,useQuery,useQueryClient } from '@tanstack/react-query'
import { login,logout,requestActionToken,requestCompleteAccountAction,requestConfirmMfa,requestDisableMfa,requestLogoutAll,requestMfaStatus,requestPinLogin,requestPinStatus,requestRemovePin,requestRequestPasswordReset,requestRevokeSession,requestSessions,requestSetupPin,requestStartMfa } from './api'
import type { ActionTokenInfo,AuthUser } from './types'
export { useMe } from '../../shared/auth'

/** Largo del PIN de acceso rápido. Tiene que coincidir con PIN_LENGTH del
 *  backend (services/session_service.py), que es quien lo valida de verdad. */
export const PIN_LENGTH = 4





function useSuccessfulLogin() {
  const queryClient = useQueryClient()
  return (user: AuthUser) => {
    queryClient.setQueryData(['auth', 'me'], user)
    void queryClient.invalidateQueries({ queryKey: ['auth', 'pin-status'] })
  }
}

export function useLogin() {
  const onSuccess = useSuccessfulLogin()
  return useMutation({ mutationFn: login, onSuccess })
}

export function usePinLogin() {
  const onSuccess = useSuccessfulLogin()
  return useMutation({
    mutationFn: requestPinLogin(),
    onSuccess,
  })
}

export function usePinStatus() {
  return useQuery({
    queryKey: ['auth', 'pin-status'],
    queryFn: requestPinStatus(),
    staleTime: 30_000,
    retry: false,
  })
}

export function useSetupPin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestSetupPin(),
    onSuccess: (status) => queryClient.setQueryData(['auth', 'pin-status'], status),
  })
}

export function useRemovePin() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestRemovePin(),
    onSuccess: () => queryClient.setQueryData(['auth', 'pin-status'], { available: false, locked_seconds: 0 }),
  })
}

export function useSessions(enabled = true) {
  return useQuery({
    queryKey: ['auth', 'sessions'],
    queryFn: requestSessions(),
    enabled,
  })
}

export function useRevokeSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestRevokeSession(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] }),
  })
}



export function useLogout() {
  const queryClient = useQueryClient()
  // La sesión se limpia también si la llamada falla (sin red, cookie ya
  // vencida, etc.): del lado del cliente el resultado deseado es el mismo,
  // volver al login, igual que hace el interceptor 401 en api/client.ts.
  const clearSession = () => {
    queryClient.clear()
    queryClient.setQueryData(['auth', 'me'], null)
  }
  return useMutation({
    mutationFn: logout,
    onSuccess: clearSession,
    onError: clearSession,
  })
}

export function useLogoutAll() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestLogoutAll(),
    onSuccess: () => {
      queryClient.clear()
      queryClient.setQueryData(['auth', 'me'], null)
    },
  })
}

export type { MfaStatus } from './types'

export function useMfaStatus(enabled = true) {
  return useQuery({
    queryKey: ['auth', 'mfa-status'],
    queryFn: requestMfaStatus(),
    enabled,
  })
}

export function useStartMfa() {
  return useMutation({
    mutationFn: requestStartMfa(),
  })
}

export function useConfirmMfa() {
  return useMutation({
    mutationFn: requestConfirmMfa(),
  })
}

export function useDisableMfa() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: requestDisableMfa(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['auth', 'mfa-status'] }),
  })
}

export type { ActionTokenInfo } from './types'

export function useRequestPasswordReset() {
  return useMutation({
    mutationFn: requestRequestPasswordReset(),
  })
}

export function useActionToken(token: string) {
  return useQuery({
    queryKey: ['auth', 'action-token', token],
    queryFn: requestActionToken(token),
    enabled: token.length > 0,
    retry: false,
  })
}

export function useCompleteAccountAction(purpose: ActionTokenInfo['purpose'] | undefined) {
  return useMutation({
    mutationFn: requestCompleteAccountAction(purpose),
  })
}
