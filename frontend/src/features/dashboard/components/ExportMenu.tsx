import { Download, Loader2 } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { useDismissiblePopover } from '../../../shared/hooks/useDismissiblePopover'
import { Button } from '../../../shared/ui/Button'
import { downloadDashboardExport } from '../api'
import type { DashboardExportReport } from '../types'

interface ReportOption {
  id: DashboardExportReport
  label: string
  hint: string
  /** Trae teléfonos y datos de pacientes: solo lo baja un administrador. */
  adminOnly: boolean
  /** El respaldo es todo el negocio, sin importar el período elegido. */
  usesPeriod: boolean
}

const REPORTS: ReportOption[] = [
  { id: 'separaciones', label: 'Separaciones y adelantos', hint: 'Una fila por cita separada, para cuadrar con la caja', adminOnly: false, usesPeriod: true },
  { id: 'vendedoras', label: 'Resultados por vendedora', hint: 'Leads, separaciones y adelantos de cada persona', adminOnly: false, usesPeriod: true },
  { id: 'leads', label: 'Leads del período', hint: 'Con etapa, origen, vendedora y etiquetas', adminOnly: true, usesPeriod: true },
  { id: 'respaldo', label: 'Respaldo completo', hint: 'Leads, citas, tareas y catálogo de todo el negocio', adminOnly: true, usesPeriod: false },
]

function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  // Revocarla en el acto cancela la descarga en Safari.
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

interface Props {
  isAdmin: boolean
  days: number
}

/**
 * Botón "Exportar" del dashboard. Los reportes siempre son del equipo
 * completo, aunque el panel esté mirando a una sola persona: es lo que se
 * usa para pagar comisiones y cuadrar con la caja.
 *
 * El analista (el contador, la agencia) baja los números sin teléfonos ni
 * DNI, y no ve los reportes que son la base de pacientes.
 */
export function ExportMenu({ isAdmin, days }: Props) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<DashboardExportReport | null>(null)
  const containerRef = useDismissiblePopover<HTMLDivElement>(open, () => setOpen(false))
  const reports = REPORTS.filter((report) => isAdmin || !report.adminOnly)

  async function exportReport(report: ReportOption) {
    setPending(report.id)
    try {
      const file = await downloadDashboardExport(report.id, days)
      saveFile(file.blob, file.filename)
      setOpen(false)
    } catch {
      // Con responseType blob el detalle del error llega como archivo y no
      // como JSON: no hay un mensaje del servidor que mostrar.
      toast.error(`No se pudo exportar "${report.label}". Intenta de nuevo.`)
    } finally {
      setPending(null)
    }
  }

  return (
    // `sm:relative` y no `relative`: en el celular la cabecera del dashboard
    // se parte en varias filas y el botón puede quedar a la izquierda; un menú
    // de 320 px anclado a su borde derecho se saldría de la pantalla. Sin
    // contenedor posicionado, el menú cuelga bajo toda la cabecera, alineado
    // a su borde derecho (como el de "Iniciar flujo" en el chat).
    <div ref={containerRef} className="sm:relative">
      <Button
        variant="secondary"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        Exportar
      </Button>
      {open && (
        <div
          role="menu"
          aria-label="Exportar a Excel"
          className="absolute right-0 top-full z-30 mt-1 w-80 sm:top-11 sm:mt-0 max-w-[calc(100vw-2rem)] rounded-xl border border-wa-border bg-white p-2 shadow-xl dark:border-wa-border-dark dark:bg-wa-head-dark"
        >
          <p className="px-2 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-wide text-wa-muted dark:text-wa-muted-dark">
            Exportar a Excel · últimos {days} días
          </p>
          {reports.map((report) => (
            <button
              key={report.id}
              type="button"
              role="menuitem"
              disabled={pending !== null}
              onClick={() => exportReport(report)}
              className="flex w-full items-start gap-2 rounded-lg px-3 py-2 text-left hover:bg-wa-hover disabled:cursor-wait disabled:opacity-60 dark:hover:bg-wa-active-dark"
            >
              {pending === report.id
                ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-wa-primary-strong" aria-hidden="true" />
                : <Download className="mt-0.5 h-4 w-4 shrink-0 text-wa-primary-strong" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-wa-text dark:text-white">{report.label}</span>
                <span className="block text-xs text-wa-muted dark:text-wa-muted-dark">
                  {report.hint}{report.usesPeriod ? '' : ' (sin período)'}
                </span>
              </span>
            </button>
          ))}
          <p className="px-2 pb-1 pt-1.5 text-[11px] text-wa-muted dark:text-wa-muted-dark">
            {isAdmin
              ? 'Siempre de todo el equipo. Queda registrado quién descarga cada archivo.'
              : 'Siempre de todo el equipo, sin teléfonos ni DNI. Queda registrado quién descarga cada archivo.'}
          </p>
        </div>
      )}
    </div>
  )
}
