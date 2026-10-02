import { ChevronLeft,ChevronRight,ExternalLink } from 'lucide-react'
import { useMemo,useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { useAppointments } from '../queries'

const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom']

function dateKey(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function AppointmentCalendar() {
  const { data = [], isLoading } = useAppointments()
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1))
  const byDay = useMemo(() => data.filter(item => !item.test_mode).reduce((map, item) => {
    const items = map.get(item.fecha) ?? []
    items.push(item)
    map.set(item.fecha, items)
    return map
  }, new Map<string, typeof data>()), [data])
  const firstOffset = (month.getDay() + 6) % 7
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate()
  const cells = Array.from({ length: firstOffset + days }, (_, index) => index < firstOffset ? null : new Date(month.getFullYear(), month.getMonth(), index - firstOffset + 1))
  const title = new Intl.DateTimeFormat('es-PE', { month: 'long', year: 'numeric' }).format(month)

  return (
    <section className="rounded-xl border border-wa-border bg-white p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark sm:p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Button variant="secondary" size="sm" aria-label="Mes anterior" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}><ChevronLeft className="h-4 w-4" /></Button>
        <h2 className="text-base font-semibold capitalize text-wa-text dark:text-wa-text-dark">{title}</h2>
        <Button variant="secondary" size="sm" aria-label="Mes siguiente" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}><ChevronRight className="h-4 w-4" /></Button>
      </div>
      {isLoading ? <p className="py-16 text-center text-sm text-wa-muted">Cargando agenda…</p> : (
        <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-wa-border dark:border-wa-border-dark">
          {WEEKDAYS.map(day => <div key={day} className="bg-wa-field px-1 py-2 text-center text-[11px] font-semibold text-wa-muted dark:bg-wa-field-dark">{day}</div>)}
          {cells.map((date, index) => {
            const key = date ? dateKey(date) : `empty-${index}`
            const items = date ? byDay.get(key) ?? [] : []
            return (
              <div key={key} className="min-h-24 border-t border-r border-wa-border p-1.5 last:border-r-0 dark:border-wa-border-dark sm:min-h-32 sm:p-2">
                {date && <><span className="text-xs font-medium text-wa-muted">{date.getDate()}</span><div className="mt-1 space-y-1">{items.slice(0, 3).map(item => (
                  <div key={item.id} title={`${item.hora} · ${item.nombre_completo} · ${item.tratamiento}`} className="rounded bg-wa-primary/10 px-1.5 py-1 text-[10px] leading-tight text-wa-primary-strong dark:text-wa-primary">
                    <span className="font-semibold">{item.hora}</span> <span className="hidden sm:inline">{item.nombre_completo}</span>
                    {item.event_link && <a href={item.event_link} target="_blank" rel="noreferrer" aria-label="Abrir en Google Calendar"><ExternalLink className="ml-1 inline h-2.5 w-2.5" /></a>}
                  </div>
                ))}{items.length > 3 && <p className="text-[10px] text-wa-muted">+{items.length - 3} más</p>}</div></>}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
