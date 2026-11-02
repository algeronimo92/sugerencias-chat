/** Resultado con que el callback de Google devuelve al CRM
 *  (`/?settings=calendar&google=connected|error&reason=...`, ver
 *  backend/app/modules/platform/google_calendar_api.py). */
export interface GoogleCalendarReturn {
  ok: boolean
  message: string
}

const ERROR_MESSAGES: Record<string, string> = {
  denied: 'Se canceló la conexión con Google.',
  expired: 'El intento de conexión venció. Vuelve a hacer clic en "Conectar con Google".',
  no_refresh_token: 'Google no entregó un acceso permanente. Vuelve a conectar y acepta todos los permisos.',
  exchange_failed: 'Google rechazó la autorización. Vuelve a intentarlo.',
}

export function readGoogleCalendarReturn(search: string): GoogleCalendarReturn | null {
  const params = new URLSearchParams(search)
  if (params.get('settings') !== 'calendar') return null
  if (params.get('google') === 'connected') return { ok: true, message: 'Google Calendar conectado' }
  return {
    ok: false,
    message: ERROR_MESSAGES[params.get('reason') ?? ''] ?? 'No se pudo conectar Google Calendar. Vuelve a intentarlo.',
  }
}
