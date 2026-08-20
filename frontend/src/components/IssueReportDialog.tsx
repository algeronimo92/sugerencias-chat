import * as Dialog from '@radix-ui/react-dialog'
import html2canvas from 'html2canvas-pro'
import { Bug, Camera, Eye, ImagePlus, Loader2, MonitorDown, ShieldCheck, X } from 'lucide-react'
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { toast } from 'sonner'
import { useCreateIssueReport } from '../hooks/useIssueReports'
import { compressImage } from '../utils/media'
import { extractErrorMessage } from '../utils/errors'
import { Button } from './ui/Button'
import { Input, Textarea, labelClass } from './ui/Input'
import { dialogContentPositionClassElevated, dialogOverlayClassElevated } from './ui/Dialog'


const MAX_EVIDENCE = 3
const MAX_BYTES = 5 * 1024 * 1024
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

interface LocalEvidence {
  id: string
  file: File
  previewUrl: string
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] ?? '')
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

function canvasToFile(canvas: HTMLCanvasElement): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('No se pudo generar la imagen de la pantalla'))
        return
      }
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      resolve(new File([blob], `captura-dermicapro-${stamp}.jpg`, { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.9)
  })
}

export function IssueReportDialog({
  open,
  currentPath,
  leadId,
  onClose,
}: {
  open: boolean
  currentPath: string
  leadId: string | null
  onClose: () => void
}) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [evidence, setEvidence] = useState<LocalEvidence[]>([])
  const [previewEvidence, setPreviewEvidence] = useState<LocalEvidence | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isCapturing, setIsCapturing] = useState(false)
  const uploadRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const evidenceRef = useRef(evidence)
  const createReport = useCreateIssueReport()

  useEffect(() => { evidenceRef.current = evidence }, [evidence])
  useEffect(() => () => {
    evidenceRef.current.forEach(item => URL.revokeObjectURL(item.previewUrl))
  }, [])

  function resetAndClose() {
    if (createReport.isPending || isCapturing) return
    evidence.forEach(item => URL.revokeObjectURL(item.previewUrl))
    setEvidence([])
    setPreviewEvidence(null)
    setTitle('')
    setDescription('')
    setError(null)
    onClose()
  }

  async function addFiles(files: File[]) {
    setError(null)
    const available = MAX_EVIDENCE - evidence.length
    if (available <= 0) {
      setError('Puedes adjuntar hasta 3 evidencias.')
      return
    }
    const next: LocalEvidence[] = []
    for (const original of files.slice(0, available)) {
      if (!ACCEPTED_TYPES.has(original.type)) {
        setError('Solo se permiten imágenes JPG, PNG o WebP.')
        continue
      }
      const file = await compressImage(original, { maxDimension: 2048, quality: 0.86, minBytes: 700_000 })
      if (file.size > MAX_BYTES) {
        setError(`${original.name} supera el máximo de 5 MB.`)
        continue
      }
      next.push({
        id: crypto.randomUUID(),
        file,
        previewUrl: URL.createObjectURL(file),
      })
    }
    if (next.length) setEvidence(current => [...current, ...next])
    if (files.length > available) setError('Se añadieron las primeras 3 evidencias.')
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''
    void addFiles(files)
  }

  function removeEvidence(id: string) {
    setEvidence(current => {
      const removed = current.find(item => item.id === id)
      if (removed) URL.revokeObjectURL(removed.previewUrl)
      return current.filter(item => item.id !== id)
    })
    setPreviewEvidence(current => current?.id === id ? null : current)
  }

  async function captureCurrentView() {
    if (evidence.length >= MAX_EVIDENCE) {
      setError('Puedes adjuntar hasta 3 evidencias.')
      return
    }
    const target = document.querySelector<HTMLElement>('[data-issue-capture-root]')
    if (!target) {
      setError('No encontramos la vista que se debe capturar.')
      return
    }
    setError(null)
    setIsCapturing(true)
    try {
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()))
      const canvas = await html2canvas(target, {
        backgroundColor: getComputedStyle(target).backgroundColor || '#f0f2f5',
        logging: false,
        scale: Math.min(window.devicePixelRatio || 1, 2),
        useCORS: true,
        width: target.clientWidth,
        height: target.clientHeight,
      })
      await addFiles([await canvasToFile(canvas)])
    } catch (captureError) {
      console.error('No se pudo capturar la vista actual', captureError)
      setError('No pudimos capturar esta pantalla. Puedes tomar una foto o subir una imagen.')
    } finally {
      setIsCapturing(false)
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    if (title.trim().length < 3) {
      setError('Escribe un título de al menos 3 caracteres.')
      return
    }
    if (description.trim().length < 10) {
      setError('Describe el problema con al menos 10 caracteres.')
      return
    }
    try {
      const attachments = await Promise.all(evidence.map(async item => ({
        contentType: item.file.type,
        dataBase64: await fileToBase64(item.file),
        filename: item.file.name,
      })))
      createReport.mutate({
        title: title.trim(),
        description: description.trim(),
        currentPath,
        leadId,
        technicalContext: {
          browser: navigator.userAgent,
          language: navigator.language,
          viewport_width: window.innerWidth,
          viewport_height: window.innerHeight,
          pixel_ratio: window.devicePixelRatio,
          theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light',
        },
        attachments,
      }, {
        onSuccess: report => {
          toast.success(`Reporte enviado · ${report.public_code}`)
          evidence.forEach(item => URL.revokeObjectURL(item.previewUrl))
          setEvidence([])
          setTitle('')
          setDescription('')
          onClose()
        },
        onError: mutationError => setError(extractErrorMessage(mutationError)),
      })
    } catch {
      setError('No se pudieron preparar las evidencias para el envío.')
    }
  }

  const busy = createReport.isPending || isCapturing

  return (
    <Dialog.Root open={open} onOpenChange={next => { if (!next) resetAndClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClassElevated} />
        <Dialog.Content
          className={`${dialogContentPositionClassElevated} flex max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] flex-col overflow-hidden rounded-2xl bg-white shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:max-w-xl dark:bg-wa-panel-dark`}
          onEscapeKeyDown={event => { if (busy) event.preventDefault() }}
          onPointerDownOutside={event => { if (busy) event.preventDefault() }}
        >
          <header className="flex shrink-0 items-center gap-2.5 border-b border-wa-border px-3 py-2.5 sm:gap-3 sm:px-4 sm:py-3 dark:border-wa-border-dark">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 sm:h-9 sm:w-9 dark:bg-amber-950 dark:text-amber-300">
              <Bug className="h-4.5 w-4.5" />
            </span>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-base font-semibold text-wa-text dark:text-white">Reportar un problema</Dialog.Title>
              <Dialog.Description className="truncate text-xs text-wa-muted dark:text-wa-muted-dark">Cuéntanos qué ocurrió sin salir de esta pantalla.</Dialog.Description>
            </div>
            <button type="button" onClick={resetAndClose} disabled={busy} aria-label="Cerrar reporte" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-wa-muted hover:bg-wa-hover disabled:opacity-40 sm:h-10 sm:w-10 dark:text-wa-muted-dark dark:hover:bg-wa-head-dark">
              <X className="h-5 w-5" />
            </button>
          </header>

          <form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto">
            <div className="space-y-3 p-3 sm:space-y-5 sm:p-5">
              <div>
                <label htmlFor="issue-title" className={labelClass}>Título *</label>
                <Input id="issue-title" value={title} onChange={event => setTitle(event.target.value)} maxLength={120} placeholder="Ej. No puedo enviar un mensaje" disabled={createReport.isPending} autoFocus />
                <p className="mt-1 text-right text-[10px] text-wa-muted">{title.length}/120</p>
              </div>

              <div>
                <label htmlFor="issue-description" className={labelClass}>Descripción *</label>
                <Textarea id="issue-description" value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} rows={5} disabled={createReport.isPending} placeholder={'¿Qué estabas intentando hacer?\n¿Qué ocurrió?\n¿Qué esperabas que ocurriera?'} className="h-24 resize-none sm:h-auto" />
                <p className="mt-1 text-right text-[10px] text-wa-muted">{description.length}/2000</p>
              </div>

              <section aria-labelledby="issue-evidence-title">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <h3 id="issue-evidence-title" className="text-xs font-medium text-wa-muted dark:text-wa-muted-dark">Evidencia</h3>
                    <p className="mt-0.5 text-[10px] text-wa-muted">Hasta 3 imágenes · 5 MB cada una</p>
                  </div>
                  <span className="text-[10px] font-medium text-wa-muted">{evidence.length}/{MAX_EVIDENCE}</span>
                </div>

                <div className="mt-2 grid grid-cols-3 gap-1.5 sm:gap-2">
                  <button type="button" aria-label="Capturar pantalla" onClick={() => void captureCurrentView()} disabled={busy || evidence.length >= MAX_EVIDENCE} className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-wa-border bg-wa-hover px-1 py-2 text-[11px] font-semibold leading-tight text-wa-text hover:border-wa-primary/40 hover:bg-green-50 disabled:opacity-40 sm:min-h-16 sm:flex-row sm:gap-2 sm:px-3 sm:text-xs dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark dark:hover:bg-green-950/30">
                    {isCapturing ? <Loader2 className="h-4 w-4 animate-spin" /> : <MonitorDown className="h-4 w-4 text-wa-primary-strong dark:text-wa-primary" />}
                    <span className="sm:hidden">{isCapturing ? 'Capturando…' : 'Capturar'}</span>
                    <span className="hidden sm:inline">{isCapturing ? 'Capturando…' : 'Capturar pantalla'}</span>
                  </button>
                  <button type="button" onClick={() => cameraRef.current?.click()} disabled={busy || evidence.length >= MAX_EVIDENCE} className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-wa-border px-1 py-2 text-[11px] font-semibold leading-tight text-wa-text hover:bg-wa-hover disabled:opacity-40 sm:min-h-16 sm:flex-row sm:gap-2 sm:px-3 sm:text-xs dark:border-wa-border-dark dark:text-wa-text-dark dark:hover:bg-wa-head-dark">
                    <Camera className="h-4 w-4" /> <span>Tomar foto</span>
                  </button>
                  <button type="button" onClick={() => uploadRef.current?.click()} disabled={busy || evidence.length >= MAX_EVIDENCE} className="flex min-h-14 min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-wa-border px-1 py-2 text-[11px] font-semibold leading-tight text-wa-text hover:bg-wa-hover disabled:opacity-40 sm:min-h-16 sm:flex-row sm:gap-2 sm:px-3 sm:text-xs dark:border-wa-border-dark dark:text-wa-text-dark dark:hover:bg-wa-head-dark">
                    <ImagePlus className="h-4 w-4" /> <span>Subir imagen</span>
                  </button>
                  <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={handleFiles} className="hidden" />
                  <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={handleFiles} className="hidden" />
                </div>

                {evidence.length > 0 && (
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {evidence.map(item => (
                      <div key={item.id} className="group relative aspect-video overflow-hidden rounded-lg border border-wa-border bg-wa-field dark:border-wa-border-dark dark:bg-wa-field-dark">
                        <button type="button" onClick={() => setPreviewEvidence(item)} aria-label={`Ver ${item.file.name}`} className="h-full w-full cursor-zoom-in">
                          <img src={item.previewUrl} alt={item.file.name} className="h-full w-full object-cover" />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/0 text-white opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100 group-focus-within:bg-black/35 group-focus-within:opacity-100">
                            <span className="flex items-center gap-1.5 rounded-full bg-black/65 px-2.5 py-1.5 text-[10px] font-semibold"><Eye className="h-3.5 w-3.5" />Vista previa</span>
                          </span>
                        </button>
                        <button type="button" onClick={() => removeEvidence(item.id)} disabled={createReport.isPending} aria-label={`Quitar ${item.file.name}`} className="absolute right-1 top-1 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-black/65 text-white hover:bg-red-600 disabled:opacity-40">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <div className="flex items-start gap-2 rounded-xl bg-blue-50 px-3 py-2 text-[11px] leading-relaxed text-blue-800 sm:py-2.5 dark:bg-blue-950/30 dark:text-blue-200">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>La captura solo incluye DermicaPro. Revísala para evitar información innecesaria.</span>
              </div>

              {error && <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">{error}</div>}
            </div>

            <footer className="sticky bottom-0 flex items-center justify-end gap-2 border-t border-wa-border bg-white px-3 py-2.5 pb-safe sm:px-4 sm:py-3 dark:border-wa-border-dark dark:bg-wa-panel-dark">
              <Button type="button" variant="ghost" onClick={resetAndClose} disabled={busy} className="flex-1 sm:flex-none">Cancelar</Button>
              <Button type="submit" disabled={busy || title.trim().length < 3 || description.trim().length < 10} className="flex-1 sm:flex-none">
                {createReport.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {createReport.isPending ? 'Enviando…' : 'Enviar reporte'}
              </Button>
            </footer>
          </form>
        </Dialog.Content>
      </Dialog.Portal>

      <Dialog.Root open={previewEvidence != null} onOpenChange={next => { if (!next) setPreviewEvidence(null) }}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-[85] bg-black/85 backdrop-blur-sm" />
          <Dialog.Content className="fixed inset-0 z-[86] flex flex-col overflow-hidden outline-none">
            <Dialog.Title className="sr-only">Vista previa de {previewEvidence?.file.name}</Dialog.Title>
            <Dialog.Description className="sr-only">Imagen adjunta al reporte antes de enviarlo.</Dialog.Description>
            <header className="flex shrink-0 items-center justify-between gap-3 bg-black/45 px-4 py-3 text-white">
              <span className="min-w-0 truncate text-sm font-medium">{previewEvidence?.file.name}</span>
              <Dialog.Close asChild>
                <button type="button" aria-label="Cerrar vista previa" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/10 transition hover:bg-white/20">
                  <X className="h-5 w-5" />
                </button>
              </Dialog.Close>
            </header>
            <div className="flex min-h-0 flex-1 items-center justify-center p-4 sm:p-8">
              {previewEvidence && <img src={previewEvidence.previewUrl} alt={`Vista previa ampliada de ${previewEvidence.file.name}`} className="max-h-full max-w-full select-none object-contain shadow-2xl" />}
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>
    </Dialog.Root>
  )
}
