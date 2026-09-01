import { CalendarClock, ExternalLink, FlaskConical, Loader2, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAppointments, type AppointmentListItem } from '../hooks/useAppointments'
import { APPOINTMENT_STATUS_COLORS, APPOINTMENT_STATUS_LABELS, type AppointmentStatus } from '../domain/appointments'
import { formatFlowAmount } from '../utils/message'
import { Button } from './ui/Button'
import { Input } from './ui/Input'

const ALL_STATUSES = Object.keys(APPOINTMENT_STATUS_LABELS) as AppointmentStatus[]
const FAILED_STATUSES: AppointmentStatus[] = ['error', 'created_with_errors']

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function formatFecha(value: string) {
  // "YYYY-MM-DD" a mediodía UTC para no correr un día al formatear en zonas
  // con offset negativo (Lima es UTC-5).
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium' }).format(new Date(`${value}T12:00:00Z`))
}

function matches(item: AppointmentListItem, query: string): boolean {
  const haystack = `${item.nombre_completo} ${item.dni} ${item.telefono} ${item.tratamiento} ${item.vendedor}`.toLocaleLowerCase('es')
  return haystack.includes(query)
}

export function AppointmentHistoryList() {
  const { data = [], isLoading, isError, refetch } = useAppointments()
  const [search, setSearch] = useState('')
  const [activeStatuses, setActiveStatuses] = useState<Set<AppointmentStatus>>(new Set(ALL_STATUSES))
  const [hideTestMode, setHideTestMode] = useState(false)

  const hidingFailed = FAILED_STATUSES.every(status => !activeStatuses.has(status))

  function toggleStatus(status: AppointmentStatus) {
    setActiveStatuses(prev => {
      const next = new Set(prev)
      if (next.has(status)) next.delete(status)
      else next.add(status)
      return next
    })
  }

  function toggleHideFailed() {
    setActiveStatuses(prev => {
      const next = new Set(prev)
      if (hidingFailed) FAILED_STATUSES.forEach(status => next.add(status))
      else FAILED_STATUSES.forEach(status => next.delete(status))
      return next
    })
  }

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es')
    return data.filter(item => {
      if (!activeStatuses.has(item.status)) return false
      if (hideTestMode && item.test_mode) return false
      if (query && !matches(item, query)) return false
      return true
    })
  }, [data, search, activeStatuses, hideTestMode])

  return (
    <div className="mx-auto max-w-3xl">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted" />
        <Input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por nombre, DNI, teléfono o tratamiento" className="pl-9" />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        {ALL_STATUSES.map(status => {
          const active = activeStatuses.has(status)
          return (
            <button
              key={status}
              type="button"
              onClick={() => toggleStatus(status)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                active
                  ? APPOINTMENT_STATUS_COLORS[status]
                  : 'bg-wa-field text-wa-muted line-through dark:bg-wa-field-dark dark:text-wa-muted-dark'
              }`}
            >
              {APPOINTMENT_STATUS_LABELS[status]}
            </button>
          )
        })}
        <span className="mx-1 h-4 w-px bg-wa-border dark:bg-wa-border-dark" />
        <button
          type="button"
          onClick={toggleHideFailed}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            hidingFailed
              ? 'bg-wa-primary text-white'
              : 'bg-wa-field text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark'
          }`}
        >
          Ocultar fallidos
        </button>
        <button
          type="button"
          onClick={() => setHideTestMode(v => !v)}
          className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors ${
            hideTestMode
              ? 'bg-wa-primary text-white'
              : 'bg-wa-field text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark'
          }`}
        >
          Ocultar pruebas
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-wa-muted" /></div>
      ) : isError ? (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/30">
          <p className="text-sm text-red-700 dark:text-red-300">No se pudo cargar el historial.</p>
          <Button variant="secondary" size="sm" onClick={() => void refetch()} className="mt-3">Reintentar</Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-wa-border bg-white px-5 py-14 text-center dark:border-wa-border-dark dark:bg-wa-panel-dark">
          <CalendarClock className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" strokeWidth={1.4} />
          {data.length === 0 ? (
            <>
              <p className="mt-3 text-sm font-medium text-wa-text dark:text-wa-text-dark">Todavía no hay citas registradas</p>
              <p className="mt-1 text-xs text-wa-muted">Las que se envíen desde el formulario van a aparecer aquí.</p>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm font-medium text-wa-text dark:text-wa-text-dark">Ningún resultado con estos filtros</p>
              <p className="mt-1 text-xs text-wa-muted">Prueba a cambiar la búsqueda o habilitar más estados.</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {visible.map(item => (
            <article key={item.id} className="rounded-xl border border-wa-border bg-white p-4 shadow-sm dark:border-wa-border-dark dark:bg-wa-panel-dark">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${APPOINTMENT_STATUS_COLORS[item.status]}`}>{APPOINTMENT_STATUS_LABELS[item.status]}</span>
                    {item.test_mode && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold text-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
                        <FlaskConical className="h-3 w-3" /> Prueba
                      </span>
                    )}
                  </div>
                  <h2 className="mt-1 truncate text-base font-semibold text-wa-text dark:text-white">{item.nombre_completo}</h2>
                  <p className="mt-0.5 text-sm text-wa-muted dark:text-wa-muted-dark">
                    {item.tratamiento}{item.detalle ? ` · ${item.detalle}` : ''}
                  </p>
                </div>
                <div className="shrink-0 text-right text-sm">
                  <p className="font-medium text-wa-text dark:text-wa-text-dark">{formatFecha(item.fecha)}</p>
                  <p className="text-wa-muted dark:text-wa-muted-dark">{item.hora}</p>
                </div>
              </div>

              {item.message && (
                <p className="mt-2 rounded-lg bg-wa-field px-3 py-1.5 text-xs text-wa-muted dark:bg-wa-field-dark dark:text-wa-muted-dark">{item.message}</p>
              )}

              <footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-wa-border pt-3 text-[11px] text-wa-muted dark:border-wa-border-dark dark:text-wa-muted-dark">
                <span className="font-medium text-wa-text dark:text-wa-text-dark">{item.vendedor}</span>
                <span>Adelanto: {formatFlowAmount(item.adelanto, 'PEN')}</span>
                <span>Registrado por {item.created_by_name} · {formatDateTime(item.created_at)}</span>
                {item.event_link && (
                  <a href={item.event_link} target="_blank" rel="noreferrer" className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-wa-primary-strong hover:bg-green-50 dark:text-wa-primary dark:hover:bg-green-950/30">
                    <ExternalLink className="h-3.5 w-3.5" /> Ver en Calendar
                  </a>
                )}
              </footer>
            </article>
          ))}
        </div>
      )}
    </div>
  )
}
