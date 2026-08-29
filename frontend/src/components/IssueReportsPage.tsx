import { Bug, CheckCircle2, Clock3, Image as ImageIcon, Loader2, MessageSquare, Plus, Search } from 'lucide-react'
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

  return (
    <div className="h-full overflow-y-auto bg-wa-app p-3 sm:p-6 dark:bg-wa-app-dark">
      <div className="mx-auto max-w-6xl">
        <header className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Bug className="h-5 w-5 text-wa-primary-strong dark:text-wa-primary" />
              <h1 className="text-xl font-semibold text-wa-text dark:text-white">{isAdmin ? 'Reportes de problemas' : 'Mis reportes'}</h1>
            </div>
            <p className="mt-1 text-sm text-wa-muted dark:text-wa-muted-dark">
              {isAdmin ? 'Revisa las evidencias y actualiza el estado de cada reporte.' : 'Consulta el avance de los problemas que reportaste.'}
            </p>
          </div>
          <Button onClick={onCreate}><Plus className="h-4 w-4" /> Nuevo reporte</Button>
        </header>

        <div className="mb-5 grid gap-2 rounded-xl border border-wa-border bg-white p-3 shadow-sm sm:grid-cols-[minmax(0,1fr)_13rem_11rem] dark:border-wa-border-dark dark:bg-wa-panel-dark">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted" />
            <Input value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por código, título o vendedor" className="pl-9" />
          </div>
          <Select value={status} onChange={event => setStatus(event.target.value as IssueReportStatus | '')} aria-label="Filtrar por estado">
            <option value="">Todos los estados</option>
            <option value="new">Nuevos</option>
            <option value="in_review">En revisión</option>
            <option value="needs_info">Necesita información</option>
            <option value="resolved">Resueltos</option>
          </Select>
          <Select value={priority} onChange={event => setPriority(event.target.value as IssueReportPriority | '')} aria-label="Filtrar por prioridad">
            <option value="">Toda prioridad</option>
            <option value="low">Baja</option>
            <option value="normal">Normal</option>
            <option value="high">Alta</option>
            <option value="critical">Crítica</option>
          </Select>
        </div>

        {isLoading ? (
          <div className="flex justify-center py-16"><Loader2 className="h-6 w-6 animate-spin text-wa-muted" /></div>
        ) : isError ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/30">
            <p className="text-sm text-red-700 dark:text-red-300">No se pudieron cargar los reportes.</p>
            <Button variant="secondary" size="sm" onClick={() => void refetch()} className="mt-3">Reintentar</Button>
          </div>
        ) : visibleReports.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-wa-border bg-white px-5 py-14 text-center dark:border-wa-border-dark dark:bg-wa-panel-dark">
            <Bug className="mx-auto h-10 w-10 text-gray-300 dark:text-gray-600" strokeWidth={1.4} />
            <p className="mt-3 text-sm font-medium text-wa-text dark:text-wa-text-dark">No hay reportes para mostrar</p>
            <p className="mt-1 text-xs text-wa-muted">Cuando encuentres un problema, puedes reportarlo sin salir de la pantalla.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {visibleReports.map(report => {
              const changing = updateReport.isPending && updateReport.variables?.id === report.id
              return (
                <article key={report.id} className={`rounded-xl border border-wa-border bg-white p-4 shadow-sm transition-opacity dark:border-wa-border-dark dark:bg-wa-panel-dark ${changing ? 'opacity-65' : ''}`}>
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[11px] font-semibold text-wa-primary-strong dark:text-wa-primary">{report.public_code}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ISSUE_STATUS_COLORS[report.status]}`}>{ISSUE_STATUS_LABELS[report.status]}</span>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${ISSUE_PRIORITY_COLORS[report.priority]}`}>{ISSUE_PRIORITY_LABELS[report.priority]}</span>
                      </div>
                      <h2 className="mt-1 text-base font-semibold text-wa-text dark:text-white">{report.title}</h2>
                      <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-wa-muted dark:text-wa-muted-dark">{report.description}</p>
                    </div>
                    {isAdmin && (
                      <Select value={report.status} onChange={event => changeStatus(report.id, event.target.value as IssueReportStatus)} disabled={changing} aria-label={`Estado de ${report.public_code}`} className="w-full shrink-0 sm:w-40">
                        <option value="new">Nuevo</option>
                        <option value="in_review">En revisión</option>
                        <option value="needs_info">Necesita información</option>
                        <option value="resolved">Resuelto</option>
                      </Select>
                    )}
                  </div>

                  {report.attachments.length > 0 && (() => {
                    const items: MediaLightboxItem[] = report.attachments.map(attachment => ({
                      src: resolveMediaUrl(attachment.media_url) ?? attachment.media_url,
                      kind: 'image',
                      alt: attachment.filename,
                      filename: attachment.filename,
                    }))
                    return (
                      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 md:max-w-2xl">
                        {items.map(item => (
                          <button key={item.src} type="button" onClick={() => setPreview({ items, item })} aria-label={`Ver ${item.filename}`} className="group relative aspect-video overflow-hidden rounded-lg border border-wa-border bg-wa-field text-left dark:border-wa-border-dark dark:bg-wa-field-dark">
                            <img src={item.src} alt={item.alt} loading="lazy" className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]" />
                            <span className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/60 px-2 py-1 text-[10px] text-white">
                              <span className="truncate"><ImageIcon className="mr-1 inline h-3 w-3" />{item.filename}</span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )
                  })()}

                  <footer className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-wa-border pt-3 text-[11px] text-wa-muted dark:border-wa-border-dark dark:text-wa-muted-dark">
                    <span className="font-medium text-wa-text dark:text-wa-text-dark">{report.reporter_name}</span>
                    <span className="inline-flex items-center gap-1"><Clock3 className="h-3 w-3" />{formatDate(report.created_at)}</span>
                    <span className="max-w-xs truncate" title={report.current_path}>{report.current_path}</span>
                    {report.resolved_at && <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400"><CheckCircle2 className="h-3 w-3" />Resuelto {formatDate(report.resolved_at)}</span>}
                    <button type="button" onClick={() => openReport(report.id)} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 font-semibold text-wa-primary-strong hover:bg-green-50 dark:text-wa-primary dark:hover:bg-green-950/30"><MessageSquare className="h-3.5 w-3.5" />{report.comment_count ? `${report.comment_count} comentarios` : 'Ver seguimiento'}</button>
                  </footer>
                </article>
              )
            })}
          </div>
        )}
      </div>
      {selectedReportId != null && <IssueReportDetailDialog reportId={selectedReportId} onClose={closeReport} />}
      {preview && <MediaLightbox src={preview.item.src} kind={preview.item.kind} alt={preview.item.alt} filename={preview.item.filename} items={preview.items} onClose={() => setPreview(null)} />}
    </div>
  )
}
