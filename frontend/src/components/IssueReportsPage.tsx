import {
  AlertTriangle,
  ArrowUpRight,
  Bug,
  CheckCircle2,
  Clock3,
  Eye,
  FilterX,
  Image as ImageIcon,
  Inbox,
  ListChecks,
  Loader2,
  MessageSquare,
  Plus,
  RefreshCw,
  Route,
  Search,
  UserRound,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import type { IssueReportPriority, IssueReportStatus } from '../types'
import { useMe } from '../hooks/useAuth'
import { useIssueReports, useUpdateIssueReport } from '../hooks/useIssueReports'
import { ISSUE_PRIORITY_COLORS, ISSUE_PRIORITY_LABELS, ISSUE_STATUS_COLORS, ISSUE_STATUS_LABELS } from '../domain/issueReports'
import { extractErrorMessage } from '../utils/errors'
import { resolveMediaUrl } from '../utils/message'
import { Button } from './ui/Button'
import { Input, Select } from './ui/Input'
import { IssueReportDetailDialog } from './IssueReportDetailDialog'
import { MediaLightbox, type MediaLightboxItem } from './MediaLightbox'

function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-PE', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

export function IssueReportsPage({ onCreate }: { onCreate: () => void }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const { data: me } = useMe()
  const isAdmin = me?.role === 'admin'
  const [status, setStatus] = useState<IssueReportStatus | ''>('')
  const [priority, setPriority] = useState<IssueReportPriority | ''>('')
  const [search, setSearch] = useState('')
  const reportFromUrl = Number(searchParams.get('report'))
  const [selectedReportId, setSelectedReportId] = useState<number | null>(Number.isInteger(reportFromUrl) && reportFromUrl > 0 ? reportFromUrl : null)
  const [preview, setPreview] = useState<{ items: MediaLightboxItem[]; item: MediaLightboxItem } | null>(null)

  useEffect(() => {
    setSelectedReportId(Number.isInteger(reportFromUrl) && reportFromUrl > 0 ? reportFromUrl : null)
  }, [reportFromUrl])
  const { data = [], isLoading, isError, refetch } = useIssueReports(status, priority)
  const summaryQuery = useIssueReports()
  const updateReport = useUpdateIssueReport()
  const visibleReports = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('es')
    if (!query) return data
    return data.filter(report =>
      report.public_code.toLocaleLowerCase('es').includes(query)
      || report.title.toLocaleLowerCase('es').includes(query)
      || report.reporter_name.toLocaleLowerCase('es').includes(query),
    )
  }, [data, search])
  const activeFilters = Boolean(search.trim() || status || priority)
  const summary = useMemo(() => {
    if (!summaryQuery.data || summaryQuery.isError) return null
    return {
      total: summaryQuery.data.length,
      new: summaryQuery.data.filter(report => report.status === 'new').length,
      inProgress: summaryQuery.data.filter(report => report.status === 'in_review' || report.status === 'needs_info').length,
      resolved: summaryQuery.data.filter(report => report.status === 'resolved').length,
    }
  }, [summaryQuery.data, summaryQuery.isError])

  function changeStatus(id: number, nextStatus: IssueReportStatus) {
    updateReport.mutate({ id, status: nextStatus }, {
      onSuccess: report => toast.success(`${report.public_code} · ${ISSUE_STATUS_LABELS[report.status]}`),
      onError: error => toast.error(extractErrorMessage(error)),
    })
  }

  function openReport(id: number) {
    setSelectedReportId(id)
    const next = new URLSearchParams(searchParams)
    next.set('report', String(id))
    setSearchParams(next, { replace: true })
  }

  function closeReport() {
    setSelectedReportId(null)
    const next = new URLSearchParams(searchParams)
    next.delete('report')
    setSearchParams(next, { replace: true })
  }

  function clearFilters() {
    setSearch('')
    setStatus('')
    setPriority('')
  }

  return (
    <main className="h-full overflow-x-hidden overflow-y-auto bg-wa-app text-wa-text dark:bg-wa-app-dark dark:text-wa-text-dark">
      <div className="mx-auto w-full max-w-[1240px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">
        <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-wa-primary-strong dark:text-wa-primary">
              <Bug className="h-4 w-4" aria-hidden="true" />
              Calidad del producto
            </div>
            <h1 className="text-2xl font-semibold text-wa-text dark:text-wa-text-dark sm:text-3xl">{isAdmin ? 'Reportes de problemas' : 'Mis reportes'}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">
              {isAdmin ? 'Revisa evidencias, actualiza estados y comunica el avance al equipo.' : 'Consulta el avance y las respuestas de los problemas que reportaste.'}
            </p>
          </div>
          <Button onClick={onCreate} className="h-11 shrink-0 bg-wa-primary-strong px-4 hover:bg-wa-primary-deep"><Plus className="h-4 w-4" aria-hidden="true" /> Nuevo reporte</Button>
        </header>

        <section className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumen de reportes" aria-busy={summaryQuery.isPending}>
          <IssueMetric icon={ListChecks} label="Total" value={summary?.total} />
          <IssueMetric icon={AlertTriangle} label="Nuevos" value={summary?.new} />
          <IssueMetric icon={Eye} label="En seguimiento" value={summary?.inProgress} />
          <IssueMetric icon={CheckCircle2} label="Resueltos" value={summary?.resolved} />
        </section>
        {summaryQuery.isPending && <p className="mt-2 text-sm text-wa-muted dark:text-wa-muted-dark" role="status">Cargando resumen…</p>}
        {summaryQuery.isError && (
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-red-700 dark:text-red-300" role="status">
            <span>No se pudo cargar el resumen.</span>
            <button type="button" onClick={() => void summaryQuery.refetch()} className="rounded px-2 py-1 font-semibold underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary">Reintentar</button>
          </div>
        )}

        <section className="mt-6 rounded-xl border border-wa-border bg-wa-panel p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark" aria-label="Filtros de reportes">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_13rem_11rem_auto] lg:items-end">
            <div className="sm:col-span-2 lg:col-span-1">
              <label htmlFor="issue-report-search" className="mb-1.5 block text-sm font-medium">Buscar reporte</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted" aria-hidden="true" />
                <Input id="issue-report-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Código, título o quién reportó" className="h-11 border-wa-border pl-10 focus:ring-wa-primary-strong dark:border-wa-border-dark" />
              </div>
            </div>
            <div>
              <label htmlFor="issue-report-status" className="mb-1.5 block text-sm font-medium">Estado</label>
              <Select id="issue-report-status" value={status} onChange={event => setStatus(event.target.value as IssueReportStatus | '')} className="h-11 border-wa-border focus:ring-wa-primary-strong dark:border-wa-border-dark">
                <option value="">Todos los estados</option><option value="new">Nuevos</option><option value="in_review">En revisión</option><option value="needs_info">Necesita información</option><option value="resolved">Resueltos</option>
              </Select>
            </div>
            <div>
              <label htmlFor="issue-report-priority" className="mb-1.5 block text-sm font-medium">Prioridad</label>
              <Select id="issue-report-priority" value={priority} onChange={event => setPriority(event.target.value as IssueReportPriority | '')} className="h-11 border-wa-border focus:ring-wa-primary-strong dark:border-wa-border-dark">
                <option value="">Todas</option><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option><option value="critical">Crítica</option>
              </Select>
            </div>
            {activeFilters && <Button variant="ghost" onClick={clearFilters} className="h-11 px-3"><FilterX className="h-4 w-4" aria-hidden="true" /> Limpiar filtros</Button>}
          </div>
        </section>

        <div className="mt-6 flex items-center justify-between gap-3 border-b border-wa-border pb-3 dark:border-wa-border-dark">
          <h2 className="text-lg font-semibold">Incidencias</h2>
          {!isLoading && !isError && <p className="text-sm text-wa-muted dark:text-wa-muted-dark" role="status">{visibleReports.length} {visibleReports.length === 1 ? 'reporte' : 'reportes'}</p>}
        </div>

        {isLoading ? (
          <div className="mt-4 flex items-center justify-center gap-3 rounded-xl border border-wa-border bg-wa-panel py-20 text-sm text-wa-muted dark:border-wa-border-dark dark:bg-wa-panel-dark dark:text-wa-muted-dark" role="status"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none text-wa-primary" aria-hidden="true" /> Cargando reportes…</div>
        ) : isError ? (
          <div className="mt-4 flex flex-col items-center rounded-xl border border-red-500/20 bg-red-500/10 px-6 py-12 text-center" role="alert"><AlertTriangle className="h-8 w-8 text-red-600 dark:text-red-300" aria-hidden="true" /><p className="mt-3 text-sm font-semibold text-red-700 dark:text-red-300">No se pudieron cargar los reportes</p><p className="mt-1 text-sm text-wa-muted dark:text-wa-muted-dark">Comprueba tu conexión y vuelve a intentarlo.</p><Button variant="secondary" onClick={() => void refetch()} className="mt-4 h-10"><RefreshCw className="h-4 w-4" aria-hidden="true" /> Reintentar</Button></div>
        ) : visibleReports.length === 0 ? (
          <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-wa-border bg-wa-panel px-6 py-12 text-center dark:border-wa-border-dark dark:bg-wa-panel-dark">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-wa-primary/10 text-wa-primary"><Inbox className="h-6 w-6" aria-hidden="true" /></span>
            <p className="mt-4 text-base font-bold text-wa-text dark:text-white">{activeFilters ? 'No encontramos coincidencias' : 'No hay reportes todavía'}</p>
            <p className="mt-1 max-w-sm text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">{activeFilters ? 'Prueba con otros términos o restablece los filtros.' : 'Cuando encuentres un problema, repórtalo con evidencia sin salir del CRM.'}</p>
            {activeFilters ? <Button variant="secondary" onClick={clearFilters} className="mt-5 h-10"><FilterX className="h-4 w-4" aria-hidden="true" /> Restablecer filtros</Button> : <Button onClick={onCreate} className="mt-5 h-10 bg-wa-primary-strong hover:bg-wa-primary-deep"><Plus className="h-4 w-4" aria-hidden="true" /> Crear primer reporte</Button>}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {visibleReports.map(report => {
              const changing = updateReport.isPending && updateReport.variables?.id === report.id
              return (
                <article key={report.id} className={`overflow-hidden rounded-xl border border-wa-border bg-wa-panel dark:border-wa-border-dark dark:bg-wa-panel-dark ${changing ? 'opacity-65' : ''}`}>
                  <div className="p-4 sm:p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-md bg-wa-field px-2 py-1 font-mono text-xs font-semibold text-wa-text dark:bg-wa-field-dark dark:text-wa-text-dark">{report.public_code}</span>
                          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${ISSUE_STATUS_COLORS[report.status]}`}>{ISSUE_STATUS_LABELS[report.status]}</span>
                          <span className={`rounded-md px-2 py-1 text-xs font-semibold ${ISSUE_PRIORITY_COLORS[report.priority]}`}>Prioridad: {ISSUE_PRIORITY_LABELS[report.priority]}</span>
                        </div>
                        <h3 className="mt-3 break-words text-lg font-semibold text-wa-text dark:text-wa-text-dark">{report.title}</h3>
                        <p className="mt-1.5 max-w-3xl whitespace-pre-wrap break-words text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">{report.description}</p>
                      </div>
                      {isAdmin && (
                        <Select value={report.status} onChange={event => changeStatus(report.id, event.target.value as IssueReportStatus)} disabled={changing} aria-label={`Cambiar estado de ${report.public_code}`} className="h-10 w-full shrink-0 border-wa-border text-sm focus:ring-wa-primary-strong sm:w-44 dark:border-wa-border-dark">
                          <option value="new">Nuevo</option><option value="in_review">En revisión</option><option value="needs_info">Necesita información</option><option value="resolved">Resuelto</option>
                        </Select>
                      )}
                    </div>

                    {report.attachments.length > 0 && (() => {
                      const items: MediaLightboxItem[] = report.attachments.map(attachment => ({ src: resolveMediaUrl(attachment.media_url) ?? attachment.media_url, kind: 'image', alt: attachment.filename, filename: attachment.filename }))
                      return (
                        <div className="mt-5">
                          <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-wa-muted dark:text-wa-muted-dark"><ImageIcon className="h-4 w-4" aria-hidden="true" /> Evidencias ({items.length})</div>
                          <div className="grid max-w-3xl grid-cols-2 gap-2 sm:grid-cols-3">
                            {items.map(item => (
                              <button key={item.src} type="button" onClick={() => setPreview({ items, item })} aria-label={`Ver ${item.filename}`} className="group relative aspect-video overflow-hidden rounded-lg border border-wa-border bg-wa-field text-left outline-none focus-visible:ring-2 focus-visible:ring-wa-primary-strong focus-visible:ring-offset-2 dark:border-wa-border-dark dark:bg-wa-field-dark">
                                <img src={item.src} alt="" loading="lazy" className="h-full w-full object-cover motion-safe:transition-transform motion-safe:duration-150 motion-safe:group-hover:scale-[1.03]" />
                                <span className="absolute inset-0 bg-black/0 transition group-hover:bg-black/10" aria-hidden="true" />
                                <span className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-black/75 px-2 py-1.5 text-xs font-medium text-white"><ImageIcon className="h-3 w-3 shrink-0" aria-hidden="true" /><span className="truncate">{item.filename}</span></span>
                              </button>
                            ))}
                          </div>
                        </div>
                      )
                    })()}
                  </div>

                  <footer className="flex flex-col gap-3 border-t border-wa-border bg-wa-field/40 px-4 py-3 text-xs text-wa-muted sm:flex-row sm:items-center sm:px-5 dark:border-wa-border-dark dark:bg-wa-field-dark/30 dark:text-wa-muted-dark">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
                      <span className="inline-flex min-w-0 items-center gap-1.5 break-words font-semibold text-wa-text dark:text-wa-text-dark"><UserRound className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{report.reporter_name}</span>
                      <time dateTime={report.created_at} className="inline-flex items-center gap-1.5"><Clock3 className="h-3.5 w-3.5" aria-hidden="true" />{formatDate(report.created_at)}</time>
                      <span className="inline-flex min-w-0 max-w-xs items-center gap-1.5" title={report.current_path}><Route className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{report.current_path}</span></span>
                      {report.resolved_at && <time dateTime={report.resolved_at} className="inline-flex items-center gap-1.5 font-medium text-green-700 dark:text-green-400"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Resuelto {formatDate(report.resolved_at)}</time>}
                    </div>
                    <button type="button" onClick={() => openReport(report.id)} aria-label={`${report.comment_count ? `Ver ${report.comment_count} comentarios` : 'Ver seguimiento'} de ${report.public_code}`} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg px-3 text-sm font-semibold text-wa-primary-strong hover:bg-wa-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong sm:ml-auto dark:text-wa-primary"><MessageSquare className="h-4 w-4" aria-hidden="true" />{report.comment_count ? `${report.comment_count} comentarios` : 'Ver seguimiento'}<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></button>
                  </footer>
                </article>
              )
            })}
          </div>
        )}
      </div>
      {selectedReportId != null && <IssueReportDetailDialog reportId={selectedReportId} onClose={closeReport} />}
      {preview && <MediaLightbox src={preview.item.src} kind={preview.item.kind} alt={preview.item.alt} filename={preview.item.filename} items={preview.items} onClose={() => setPreview(null)} />}
    </main>
  )
}

function IssueMetric({ icon: Icon, label, value }: { icon: typeof Bug; label: string; value?: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-wa-border bg-wa-panel p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark">
      <Icon className="h-5 w-5 shrink-0 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
      <div><p className="text-xl font-semibold leading-none text-wa-text dark:text-wa-text-dark">{value ?? '—'}</p><p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark">{label}</p></div>
    </div>
  )
}
