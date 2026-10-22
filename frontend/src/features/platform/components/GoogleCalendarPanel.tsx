import { AlertTriangle, CalendarCheck2, Link2, Loader2, Unlink } from 'lucide-react'
import { Button } from '../../../shared/ui/Button'
import { Checkbox } from '../../../shared/ui/Checkbox'
import { Select, labelClass } from '../../../shared/ui/Input'
import { asApiError } from '../../../shared/http/errors'
import { extractErrorMessage } from '../../../shared/utils/errors'
import {
  useConnectGoogleCalendar,
  useDisconnectGoogleCalendar,
  useGoogleCalendars,
  useGoogleCalendarStatus,
  useSaveGoogleCalendarSettings,
  useSelectGoogleCalendar,
} from '../hooks/useGoogleCalendar'
import { useBusinessTimezones } from '../hooks/useSettings'

const DEFAULT_TIMEZONE = 'America/Lima'

const cardClass = 'space-y-3 rounded-xl border border-wa-border p-4 dark:border-wa-border-dark'
const titleClass = 'flex items-center gap-2 text-sm font-medium text-wa-text dark:text-wa-text-dark'
const hintClass = 'text-[11px] text-wa-muted dark:text-wa-muted-dark'
const errorClass = 'text-xs text-red-500 dark:text-red-400'

// "Conectar con Google": el negocio autoriza su cuenta con el cliente OAuth de
// la plataforma y elige el calendario de una lista. Reemplaza pegar Calendar
// ID, Client ID, Client Secret y Refresh Token a mano.
export function GoogleCalendarPanel() {
  const { data: status, isLoading, error: statusError } = useGoogleCalendarStatus()
  const connect = useConnectGoogleCalendar()

  if (isLoading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-wa-muted dark:text-wa-muted-dark" aria-label="Cargando" />
      </div>
    )
  }
  if (statusError || !status) {
    return <p className={`${errorClass} py-8 text-center`}>No se pudo cargar el estado de Google Calendar.</p>
  }

  if (!status.connected) {
    return (
      <div className={cardClass}>
        <div className={titleClass}>
          <CalendarCheck2 className="h-4 w-4" aria-hidden="true" />
          Google Calendar
        </div>
        <p className={hintClass}>
          Cada cita que se registre en el CRM se crea también como evento en el calendario que elijas. Es opcional:
          las citas siempre quedan guardadas en la app.
        </p>
        {status.oauth_available ? (
          <Button onClick={() => connect.mutate()} disabled={connect.isPending}>
            {connect.isPending
              ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              : <Link2 className="h-4 w-4" aria-hidden="true" />}
            Conectar con Google
          </Button>
        ) : (
          <p className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-[11px] text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-300">
            El operador de la plataforma todavía no habilitó la conexión con Google.
          </p>
        )}
        {connect.isError && <p className={errorClass}>{extractErrorMessage(connect.error)}</p>}
      </div>
    )
  }

  return <ConnectedCalendar status={status} onReconnect={() => connect.mutate()} reconnecting={connect.isPending} />
}

interface ConnectedProps {
  status: NonNullable<ReturnType<typeof useGoogleCalendarStatus>['data']>
  onReconnect: () => void
  reconnecting: boolean
}

function ConnectedCalendar({ status, onReconnect, reconnecting }: ConnectedProps) {
  const calendars = useGoogleCalendars(true)
  const select = useSelectGoogleCalendar()
  const disconnect = useDisconnectGoogleCalendar()
  const save = useSaveGoogleCalendarSettings()
  const { data: timezones = [], isLoading: timezonesLoading } = useBusinessTimezones()
  const calendarsError = asApiError(calendars.error)
  const needsReconnect = calendarsError?.code === 'google_reconnect'

  return (
    <div className={cardClass}>
      <div className={titleClass}>
        <CalendarCheck2 className="h-4 w-4 text-wa-primary-strong dark:text-wa-primary" aria-hidden="true" />
        Google Calendar conectado
      </div>
      <p className={hintClass}>
        {status.account_email
          ? <>Cuenta: <span className="font-medium text-wa-text dark:text-wa-text-dark">{status.account_email}</span></>
          : 'Conectado con credenciales cargadas a mano. Reconecta para pasar a la conexión directa con Google.'}
      </p>

      {needsReconnect ? (
        <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 dark:border-amber-900/60 dark:bg-amber-950/20">
          <p className="flex items-start gap-1.5 text-[11px] text-amber-800 dark:text-amber-300">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Google ya no acepta esta conexión (expiró o se quitó el acceso). Las citas nuevas no llegarán al calendario
            hasta que reconectes.
          </p>
          {status.oauth_available && (
            <Button size="sm" onClick={onReconnect} disabled={reconnecting}>
              {reconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Link2 className="h-3.5 w-3.5" aria-hidden="true" />}
              Reconectar
            </Button>
          )}
        </div>
      ) : (
        <div>
          <label htmlFor="google-calendar-id" className={labelClass}>Calendario donde se crean las citas</label>
          <Select
            id="google-calendar-id"
            value={status.calendar_id ?? ''}
            onChange={(event) => select.mutate(event.target.value)}
            disabled={calendars.isLoading || select.isPending || !calendars.data}
            className="w-full bg-wa-hover text-sm dark:bg-wa-head-dark"
          >
            {calendars.isLoading && <option value={status.calendar_id ?? ''}>Cargando calendarios…</option>}
            {calendars.data?.map((calendar) => (
              <option key={calendar.id} value={calendar.id}>
                {calendar.primary ? `${calendar.summary} (principal)` : calendar.summary}
              </option>
            ))}
          </Select>
          {calendars.isError && <p className={`${errorClass} mt-1`}>{extractErrorMessage(calendars.error)}</p>}
          {select.isError && <p className={`${errorClass} mt-1`}>{extractErrorMessage(select.error)}</p>}
        </div>
      )}

      <div>
        <label htmlFor="google-calendar-timezone" className={labelClass}>Zona horaria de las citas</label>
        <Select
          id="google-calendar-timezone"
          value={status.business_timezone || DEFAULT_TIMEZONE}
          onChange={(event) => save.mutate({ business_timezone: event.target.value })}
          disabled={timezonesLoading || save.isPending}
          className="w-full bg-wa-hover text-sm dark:bg-wa-head-dark"
        >
          {timezonesLoading && <option value={status.business_timezone}>Cargando zonas horarias…</option>}
          {!timezonesLoading && timezones.map((timezone) => (
            <option key={timezone.id} value={timezone.id}>{timezone.label}</option>
          ))}
        </Select>
      </div>

      <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
        <Checkbox
          checked={status.enabled}
          disabled={save.isPending}
          onCheckedChange={(checked) => save.mutate({ google_calendar_enabled: checked ? 'true' : 'false' })}
        />
        Crear un evento en Google por cada cita nueva
      </label>
      {save.isError && <p className={errorClass}>{extractErrorMessage(save.error)}</p>}

      <div className="flex justify-end border-t border-wa-border pt-3 dark:border-wa-border-dark">
        <Button variant="ghost" size="sm" onClick={() => disconnect.mutate()} disabled={disconnect.isPending}>
          {disconnect.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : <Unlink className="h-3.5 w-3.5" aria-hidden="true" />}
          Desconectar
        </Button>
      </div>
      {disconnect.isError && <p className={errorClass}>{extractErrorMessage(disconnect.error)}</p>}
    </div>
  )
}
