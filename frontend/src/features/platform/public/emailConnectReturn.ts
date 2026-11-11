/** Resultado con que el callback de "Conectar con…" del correo devuelve al
 *  CRM (`/?settings=email&email=connected|error&provider=...&reason=...`, ver
 *  backend/app/modules/platform/email_settings_api.py). */
export interface EmailConnectReturn {
  ok: boolean
  message: string
}

const PROVIDER_LABELS: Record<string, string> = { google: 'Google', microsoft: 'Microsoft', zoho: 'Zoho' }

const ERROR_MESSAGES: Record<string, string> = {
  denied: 'Se canceló la conexión del correo.',
  expired: 'El intento de conexión venció. Vuelve a hacer clic en "Conectar".',
  no_refresh_token: 'El proveedor no entregó un acceso permanente. Vuelve a conectar y acepta todos los permisos.',
  exchange_failed: 'El proveedor rechazó la autorización. Vuelve a intentarlo.',
  no_mailbox: 'La cuenta no tiene un buzón de Zoho Mail para enviar.',
  unavailable: 'La plataforma desactivó esta conexión. Usa otro proveedor.',
}

export function readEmailConnectReturn(search: string): EmailConnectReturn | null {
  const params = new URLSearchParams(search)
  if (params.get('settings') !== 'email') return null
  const provider = PROVIDER_LABELS[params.get('provider') ?? ''] ?? 'el proveedor'
  if (params.get('email') === 'connected') return { ok: true, message: `Correo conectado con ${provider}` }
  return {
    ok: false,
    message: ERROR_MESSAGES[params.get('reason') ?? ''] ?? `No se pudo conectar el correo con ${provider}. Vuelve a intentarlo.`,
  }
}
