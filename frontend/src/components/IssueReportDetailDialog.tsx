import * as Dialog from '@radix-ui/react-dialog'
import { Activity, Clock3, Image as ImageIcon, Loader2, MessageSquare, Send, X } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { toast } from 'sonner'
import type { IssueReportEvent, IssueReportPriority, IssueReportStatus } from '../types'
import { useMe } from '../hooks/useAuth'
import { useAddIssueReportComment, useIssueReport, useUpdateIssueReport } from '../hooks/useIssueReports'
import { ISSUE_PRIORITY_LABELS, ISSUE_STATUS_LABELS } from '../domain/issueReports'
import { extractErrorMessage } from '../utils/errors'
import { resolveMediaUrl } from '../utils/message'
import { Button } from './ui/Button'
import { Select, Textarea } from './ui/Input'
import { dialogContentPositionClassElevated, dialogOverlayClassElevated } from './ui/Dialog'
import { MediaLightbox, type MediaLightboxItem } from './MediaLightbox'


function formatDate(value: string) {
  return new Intl.DateTimeFormat('es-PE', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function eventDescription(event: IssueReportEvent) {
  if (event.event_type === 'created') return 'creó el reporte'
  if (event.event_type === 'status_changed') {
    return `cambió el estado de ${ISSUE_STATUS_LABELS[event.previous_value as IssueReportStatus] ?? event.previous_value} a ${ISSUE_STATUS_LABELS[event.new_value as IssueReportStatus] ?? event.new_value}`
  }
  return `cambió la prioridad de ${ISSUE_PRIORITY_LABELS[event.previous_value as IssueReportPriority] ?? event.previous_value} a ${ISSUE_PRIORITY_LABELS[event.new_value as IssueReportPriority] ?? event.new_value}`
}

export function IssueReportDetailDialog({ reportId, onClose }: { reportId: number; onClose: () => void }) {
  const { data: me } = useMe()
  const isAdmin = me?.role === 'admin'
  const { data: report, isLoading, isError, refetch } = useIssueReport(reportId)
  const updateReport = useUpdateIssueReport()
  const addComment = useAddIssueReportComment()
  const [comment, setComment] = useState('')
  const [preview, setPreview] = useState<{ items: MediaLightboxItem[]; item: MediaLightboxItem } | null>(null)

  function update(values: { status?: IssueReportStatus; priority?: IssueReportPriority }) {
    updateReport.mutate({ id: reportId, ...values }, {
      onSuccess: next => toast.success(`${next.public_code} actualizado`),
      onError: error => toast.error(extractErrorMessage(error)),
    })
  }

  function submitComment(event: FormEvent) {
    event.preventDefault()
    const content = comment.trim()
    if (!content) return
    addComment.mutate({ reportId, content }, {
      onSuccess: () => setComment(''),
      onError: error => toast.error(extractErrorMessage(error)),
    })
  }

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClassElevated} />
        <Dialog.Content aria-describedby={undefined} className={`${dialogContentPositionClassElevated} flex h-[100dvh] w-full flex-col overflow-hidden bg-wa-app shadow-2xl sm:h-[min(90dvh,52rem)] sm:max-w-5xl sm:rounded-2xl dark:bg-wa-app-dark`}>
          <header className="flex shrink-0 items-center gap-3 border-b border-wa-border bg-white px-4 py-3 dark:border-wa-border-dark dark:bg-wa-panel-dark">
            <div className="min-w-0 flex-1">
              <Dialog.Title className="truncate text-base font-semibold text-wa-text dark:text-white">{report?.public_code ?? 'Reporte'}</Dialog.Title>
              {report && <p className="truncate text-xs text-wa-muted dark:text-wa-muted-dark">{report.title}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Cerrar detalle" className="flex h-10 w-10 items-center justify-center rounded-lg text-wa-muted hover:bg-wa-hover dark:text-wa-muted-dark dark:hover:bg-wa-head-dark"><X className="h-5 w-5" /></button>
          </header>

          {isLoading ? (
            <div className="flex flex-1 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-wa-muted" /></div>
          ) : isError || !report ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center"><p className="text-sm text-red-600">No se pudo cargar el reporte.</p><Button variant="secondary" size="sm" onClick={() => void refetch()}>Reintentar</Button></div>
          ) : (
            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_20rem]">
              <main className="min-h-0 overflow-y-auto p-4 sm:p-5">
                <div className="rounded-xl border border-wa-border bg-white p-4 dark:border-wa-border-dark dark:bg-wa-panel-dark">
                  <div className="flex flex-wrap gap-2 text-[11px] text-wa-muted dark:text-wa-muted-dark">
                    <span className="font-semibold text-wa-text dark:text-wa-text-dark">{report.reporter_name}</span>
                    <span>·</span><span>{formatDate(report.created_at)}</span><span>·</span><span className="truncate">{report.current_path}</span>
                  </div>
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-wa-text dark:text-wa-text-dark">{report.description}</p>
                  {report.attachments.length > 0 && (() => {
                    const items: MediaLightboxItem[] = report.attachments.map(attachment => ({
                      src: resolveMediaUrl(attachment.media_url) ?? attachment.media_url,
                      kind: 'image',
                      alt: attachment.filename,
                      filename: attachment.filename,
                    }))
                    return (
                      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {items.map(item => (
                          <button key={item.src} type="button" onClick={() => setPreview({ items, item })} aria-label={`Ver ${item.filename}`} className="group relative aspect-video overflow-hidden rounded-lg border border-wa-border text-left dark:border-wa-border-dark">
                            <img src={item.src} alt={item.alt} className="h-full w-full object-cover" />
                            <span className="absolute inset-x-0 bottom-0 flex items-center bg-black/60 px-2 py-1 text-[10px] text-white"><span className="truncate"><ImageIcon className="mr-1 inline h-3 w-3" />{item.filename}</span></span>
                          </button>
                        ))}
                      </div>
                    )
                  })()}
                </div>

                <section className="mt-4 rounded-xl border border-wa-border bg-white dark:border-wa-border-dark dark:bg-wa-panel-dark">
                  <div className="flex items-center gap-2 border-b border-wa-border px-4 py-3 dark:border-wa-border-dark"><MessageSquare className="h-4 w-4 text-wa-primary-strong" /><h2 className="text-sm font-semibold text-wa-text dark:text-white">Conversación</h2><span className="text-[10px] text-wa-muted">{report.comments.length}</span></div>
                  <div className="max-h-72 space-y-3 overflow-y-auto p-4">
                    {report.comments.length === 0 && <p className="py-6 text-center text-xs text-wa-muted">Todavía no hay comentarios.</p>}
                    {report.comments.map(item => {
                      const own = item.author_user_id === me?.id
                      return <div key={item.id} className={`flex ${own ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-xl px-3 py-2 ${own ? 'bg-wa-out dark:bg-wa-out-dark' : 'bg-wa-field dark:bg-wa-head-dark'}`}><p className="text-[10px] font-semibold text-wa-primary-strong dark:text-wa-primary">{item.author_name}{item.author_role === 'admin' ? ' · Administrador' : ''}</p><p className="mt-0.5 whitespace-pre-wrap text-sm text-wa-text dark:text-wa-text-dark">{item.content}</p><p className="mt-1 text-right text-[9px] text-wa-muted">{formatDate(item.created_at)}</p></div></div>
                    })}
                  </div>
                  <form onSubmit={submitComment} className="flex items-end gap-2 border-t border-wa-border p-3 dark:border-wa-border-dark">
                    <Textarea value={comment} onChange={event => setComment(event.target.value)} maxLength={2000} rows={2} placeholder="Escribe una respuesta o solicita más información…" className="min-h-11 resize-none" />
                    <Button type="submit" size="sm" disabled={!comment.trim() || addComment.isPending} aria-label="Enviar comentario">{addComment.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}</Button>
                  </form>
                </section>
              </main>

              <aside className="min-h-0 overflow-y-auto border-t border-wa-border bg-white p-4 lg:border-l lg:border-t-0 dark:border-wa-border-dark dark:bg-wa-panel-dark">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-wa-muted">Seguimiento</h2>
                <div className="mt-3 space-y-3">
                  <div><label className="mb-1 block text-[11px] text-wa-muted">Estado</label><Select value={report.status} onChange={event => update({ status: event.target.value as IssueReportStatus })} disabled={!isAdmin || updateReport.isPending}><option value="new">Nuevo</option><option value="in_review">En revisión</option><option value="needs_info">Necesita información</option><option value="resolved">Resuelto</option></Select></div>
                  <div><label className="mb-1 block text-[11px] text-wa-muted">Prioridad</label><Select value={report.priority} onChange={event => update({ priority: event.target.value as IssueReportPriority })} disabled={!isAdmin || updateReport.isPending}><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option><option value="critical">Crítica</option></Select></div>
                  {!isAdmin && <p className="text-[10px] leading-relaxed text-wa-muted">Solo un administrador puede cambiar el estado y la prioridad.</p>}
                </div>

                <div className="mt-6 flex items-center gap-2"><Activity className="h-4 w-4 text-wa-muted" /><h2 className="text-xs font-semibold uppercase tracking-wide text-wa-muted">Historial</h2></div>
                <div className="mt-3 space-y-3 border-l border-wa-border pl-3 dark:border-wa-border-dark">
                  {report.events.map(event => <div key={event.id} className="relative text-[11px] leading-relaxed text-wa-muted dark:text-wa-muted-dark"><span className="absolute -left-[0.94rem] top-1 h-2 w-2 rounded-full bg-wa-primary ring-2 ring-white dark:ring-wa-panel-dark" /><span className="font-medium text-wa-text dark:text-wa-text-dark">{event.actor_name ?? 'Sistema'}</span> {eventDescription(event)}<span className="mt-0.5 flex items-center gap-1 text-[9px]"><Clock3 className="h-2.5 w-2.5" />{formatDate(event.created_at)}</span></div>)}
                </div>
              </aside>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
      {preview && <MediaLightbox src={preview.item.src} kind={preview.item.kind} alt={preview.item.alt} filename={preview.item.filename} items={preview.items} onClose={() => setPreview(null)} />}
    </Dialog.Root>
  )
}
