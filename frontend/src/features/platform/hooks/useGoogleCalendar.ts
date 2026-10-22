import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  authorizeGoogleCalendar,
  disconnectGoogleCalendar,
  fetchGoogleCalendars,
  fetchGoogleCalendarStatus,
  saveSettings,
  selectGoogleCalendar,
} from '../api'
import { settingsKeys } from '../keys'
import type { GoogleCalendarStatus } from '../types'

export type { GoogleCalendarItem, GoogleCalendarStatus } from '../types'

export function useGoogleCalendarStatus() {
  return useQuery({
    queryKey: settingsKeys.googleCalendarStatus,
    queryFn: fetchGoogleCalendarStatus,
  })
}

/** Solo con la cuenta conectada: listar sin token es un 409 seguro. */
export function useGoogleCalendars(enabled: boolean) {
  return useQuery({
    queryKey: settingsKeys.googleCalendars,
    queryFn: fetchGoogleCalendars,
    enabled,
    retry: false,
  })
}

/** Pide la URL de consentimiento y deja la página: Google vuelve al CRM con
 *  ?settings=calendar&google=... (lo lee app/layout.tsx). */
export function useConnectGoogleCalendar() {
  return useMutation({
    mutationFn: () => authorizeGoogleCalendar(window.location.origin),
    onSuccess: (url) => window.location.assign(url),
  })
}

function useStatusMutation<T>(mutationFn: (value: T) => Promise<GoogleCalendarStatus>, forgetCalendars = false) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: (status) => {
      queryClient.setQueryData(settingsKeys.googleCalendarStatus, status)
      if (forgetCalendars) queryClient.removeQueries({ queryKey: settingsKeys.googleCalendars })
      // La zona horaria y el interruptor también viven en /api/settings.
      queryClient.invalidateQueries({ queryKey: settingsKeys.all, exact: true })
    },
  })
}

export function useSelectGoogleCalendar() {
  return useStatusMutation(selectGoogleCalendar)
}

export function useDisconnectGoogleCalendar() {
  return useStatusMutation<void>(() => disconnectGoogleCalendar(), true)
}

/** Zona horaria e interruptor: se guardan como ajustes comunes, pero el panel
 *  los lee del estado de la conexión. */
export function useSaveGoogleCalendarSettings() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: saveSettings,
    onSuccess: (settings) => {
      queryClient.setQueryData(settingsKeys.all, settings)
      queryClient.invalidateQueries({ queryKey: settingsKeys.googleCalendarStatus })
    },
  })
}
