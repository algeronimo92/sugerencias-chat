import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BadgeCheck, CheckCircle2, FileAudio, FileText, Image, Loader2, Maximize2, MessageSquareText, Send, Video, X } from 'lucide-react'
import type { Chat, MessageTemplate, TemplateAttachment } from '../types'
import { useSendTemplate } from '../hooks/useMessages'
import { useTemplateCapabilities } from '../hooks/useTemplates'
import { extractErrorMessage } from '../utils/errors'
import { parseRichText, resolveMediaUrl } from '../utils/message'
import { renderInteractiveConfig, renderOfficialParameterValues, renderOfficialTemplate, renderTemplate } from '../utils/templates'
import { MediaLightbox } from './MediaLightbox'
import { AudioPlayer, VideoPlayer } from './MediaPlayer'

interface Props {
  chat: Chat
  template: MessageTemplate
  onClose: () => void
}

interface OpenMedia {
  src: string
  kind: 'image' | 'video'
  alt: string
}

function attachmentKind(attachment: TemplateAttachment) {
  if (attachment.content_type.startsWith('image/')) return 'Imagen'
  if (attachment.content_type.startsWith('video/')) return 'Video'
  if (attachment.content_type.startsWith('audio/')) return 'Audio'
  return 'Documento'
}

function attachmentIcon(attachment: TemplateAttachment) {
  if (attachment.content_type.startsWith('image/')) return Image
  if (attachment.content_type.startsWith('video/')) return Video
  if (attachment.content_type.startsWith('audio/')) return FileAudio
  return FileText
}

function attachmentMessageContent(attachment: TemplateAttachment) {
  if (attachment.content_type.startsWith('image/')) return '<image></image>'
  if (attachment.content_type.startsWith('video/')) return '<video></video>'
  if (attachment.content_type.startsWith('audio/')) return '<audio></audio>'
  return `<other>${attachment.filename}</other>`
}

function RichMessage({ text }: { text: string }) {
  return <>{parseRichText(text).map((segment, index) => {
    if (segment.type === 'link') return <span key={index} className="break-all text-blue-600 underline dark:text-blue-400">{segment.text}</span>
    if (segment.type === 'bold') return <strong key={index}>{segment.text}</strong>
    if (segment.type === 'italic') return <em key={index}>{segment.text}</em>
    if (segment.type === 'strike') return <span key={index} className="line-through">{segment.text}</span>
    if (segment.type === 'code') return <code key={index} className="rounded bg-black/10 px-1 py-0.5 font-mono text-[0.9em] dark:bg-white/10">{segment.text}</code>
    return <span key={index}>{segment.text}</span>
  })}</>
}

function AttachmentBubble({ attachment, onOpen }: { attachment: TemplateAttachment; onOpen: (media: OpenMedia) => void }) {
  const url = resolveMediaUrl(attachment.media_url) ?? ''
  const kind = attachmentKind(attachment)
  const Icon = attachmentIcon(attachment)
  const isImage = attachment.content_type.startsWith('image/')
  const isVideo = attachment.content_type.startsWith('video/')
  const isAudio = attachment.content_type.startsWith('audio/')

  return (
    <div className="ml-auto w-fit max-w-[88%] rounded-xl rounded-tr-sm bg-wa-out p-1.5 text-wa-text shadow-sm dark:bg-wa-out-dark dark:text-wa-text-dark">
      {isImage && (
        <button type="button" onClick={() => onOpen({ src: url, kind: 'image', alt: attachment.filename })} className="group relative block overflow-hidden rounded-lg">
          <img src={url} alt={attachment.filename} className="max-h-64 w-full min-w-52 object-cover" />
          <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100"><Maximize2 className="h-3.5 w-3.5" /></span>
        </button>
      )}
      {isVideo && (
        <VideoPlayer src={url} className="h-64 min-w-52 w-full" onExpand={() => onOpen({ src: url, kind: 'video', alt: attachment.filename })} />
      )}
      {isAudio && (
        <AudioPlayer src={url} variant="bubble" className="min-w-64" />
      )}
      {!isImage && !isVideo && !isAudio && (
        <a href={url} target="_blank" rel="noreferrer" className="flex min-w-64 items-center gap-3 rounded-lg bg-white/60 px-3 py-3 hover:bg-white/80 dark:bg-black/20 dark:hover:bg-black/30">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-600 text-white"><FileText className="h-5 w-5" /></span>
          <span className="min-w-0"><span className="block truncate text-sm font-medium">{attachment.filename}</span><span className="block text-[10px] uppercase text-wa-muted dark:text-wa-muted-dark">{kind} · Abrir archivo</span></span>
        </a>
      )}
      {(isImage || isVideo || isAudio) && (
        <div className="flex items-center gap-1.5 px-1.5 pb-0.5 pt-1.5 text-[11px] text-gray-700 dark:text-gray-300">
          <Icon className="h-3 w-3 shrink-0" /><span className="truncate">{attachment.filename}</span>
        </div>
      )}
      <div className="px-1.5 text-right text-[9px] text-wa-muted dark:text-wa-muted-dark">Vista previa</div>
    </div>
  )
}

export function TemplateSendDialog({ chat, template, onClose }: Props) {
  const isOfficial = template.template_type === 'official'
  const isInteractive = template.interactive_type !== 'none'
  const [internalText, setInternalText] = useState(renderTemplate(template, chat))
  const [parameters, setParameters] = useState(() => renderOfficialParameterValues(template, chat))
  const [openMedia, setOpenMedia] = useState<OpenMedia | null>(null)
  const send = useSendTemplate(chat.chat_id)
  const { data: capabilities, isLoading: isLoadingCapabilities } = useTemplateCapabilities()
  const usesSafeInteractiveFallback = isInteractive && capabilities?.integration !== 'WHATSAPP-BUSINESS'
  const text = isOfficial ? renderOfficialTemplate(template, chat, parameters) : internalText
  const interactiveConfig = useMemo(() => renderInteractiveConfig(template, chat), [template, chat])
  const safeInteractivePreview = useMemo(() => {
    if (!isInteractive) return ''
    const lines = [`*${interactiveConfig.title ?? ''}*`, text, '']
    if (template.interactive_type === 'buttons') {
      const buttons = interactiveConfig.buttons ?? []
      const replyOnly = buttons.every(button => button.type === 'reply')
      buttons.forEach((button, index) => {
        const detail = button.type === 'url' ? button.url : button.type === 'call' ? button.phoneNumber : button.type === 'copy' ? button.copyCode : null
        lines.push(button.type === 'reply' ? `${index + 1}. ${button.displayText}` : `• ${button.displayText}: ${detail ?? ''}`)
      })
      if (replyOnly) lines.push('', 'Responde con el número de la opción que deseas.')
      if (interactiveConfig.footer) lines.push('', interactiveConfig.footer)
    } else {
      let optionNumber = 1
      for (const section of interactiveConfig.sections ?? []) {
        lines.push(`*${section.title}*`)
        for (const row of section.rows) {
          lines.push(`${optionNumber}. ${row.title} — ${row.description}`)
          optionNumber += 1
        }
        lines.push('')
      }
      lines.push('Responde con el número de la opción que deseas.')
      if (interactiveConfig.footerText) lines.push('', interactiveConfig.footerText)
    }
    return lines.join('\n')
  }, [interactiveConfig, isInteractive, template.interactive_type, text])
  const attachments = useMemo(
    () => [...template.attachments].sort((a, b) => a.position - b.position || a.id - b.id),
    [template.attachments],
  )
  const unresolvedVariables = useMemo(
    () => [...new Set(Array.from(
      `${text}\n${isInteractive ? JSON.stringify(interactiveConfig) : ''}`.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g),
      match => match[1],
    ))],
    [text, interactiveConfig, isInteractive],
  )
  const stepCount = isOfficial || isInteractive ? 1 : (text.trim() ? 1 : 0) + attachments.length
  const officialReady = !isOfficial || (
    template.official_status === 'APPROVED'
    && capabilities?.official_sending_supported === true
    && parameters.every(value => value.trim())
  )
  const canSend = stepCount > 0 && unresolvedVariables.length === 0 && officialReady && !send.isPending && !isLoadingCapabilities

  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape' && !send.isPending && !openMedia) onClose()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown, true)
    }
  }, [onClose, openMedia, send.isPending])

  function closeDialog() {
    if (!send.isPending) onClose()
  }

  function confirmSend() {
    if (!canSend) return
    const interactiveContent = usesSafeInteractiveFallback
      ? safeInteractivePreview
      : `${interactiveConfig.title ?? ''}\n${text}`.trim()
    const optimisticMessages = isOfficial || isInteractive
      ? [{ content: isInteractive ? interactiveContent : text }]
      : [
          ...(text.trim() ? [{ content: text }] : []),
          ...attachments.map(attachment => ({
            content: attachmentMessageContent(attachment),
            media_url: attachment.media_url,
          })),
        ]
    send.mutate({
      templateId: template.id,
      text,
      parameters: isOfficial ? parameters : [],
      optimisticMessages,
    }, { onSuccess: onClose })
  }

  return (
    <>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 backdrop-blur-[1px]" onMouseDown={event => { if (event.target === event.currentTarget) closeDialog() }}>
        <div role="dialog" aria-modal="true" aria-labelledby="template-preview-title" className="flex max-h-[94vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-wa-border bg-white shadow-2xl dark:border-wa-border-dark dark:bg-wa-panel-dark">
          <header className="flex items-center justify-between gap-4 border-b border-wa-border px-5 py-4 dark:border-wa-border-dark">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                {isOfficial ? <BadgeCheck className="h-5 w-5 shrink-0 text-blue-600" /> : <MessageSquareText className="h-5 w-5 shrink-0 text-wa-primary-strong" />}
                <h2 id="template-preview-title" className="truncate font-semibold text-wa-text dark:text-white">Vista previa antes de enviar</h2>
              </div>
              <p className="mt-0.5 truncate pl-7 text-xs text-wa-muted dark:text-wa-muted-dark">{template.name} · {isOfficial ? 'Plantilla oficial Meta' : isInteractive ? template.interactive_type === 'buttons' ? 'Mensaje con botones' : 'Mensaje con lista' : 'Plantilla interna'} · Para {chat.name || chat.phone || 'el contacto'}</p>
            </div>
            <button type="button" onClick={closeDialog} disabled={send.isPending} aria-label="Cerrar vista previa" className="rounded-lg p-2 text-wa-muted hover:bg-wa-field hover:text-gray-600 disabled:opacity-40 dark:hover:bg-wa-head-dark dark:hover:text-wa-text-dark"><X className="h-5 w-5" /></button>
          </header>

          <div className="grid min-h-0 flex-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.85fr)] lg:overflow-hidden">
            <section className="space-y-5 overflow-y-auto p-5">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <label htmlFor="template-preview-text" className="text-xs font-semibold text-gray-700 dark:text-wa-text-dark">{isOfficial ? 'Texto oficial aprobado' : isInteractive ? 'Descripción del mensaje interactivo' : 'Texto del mensaje'}</label>
                  <span className="text-[10px] text-wa-muted">{text.length} caracteres</span>
                </div>
                <textarea id="template-preview-text" rows={7} value={text} onChange={event => setInternalText(event.target.value)} readOnly={isOfficial} disabled={send.isPending} className="w-full resize-y rounded-xl border border-wa-border bg-white px-3.5 py-3 text-sm text-wa-text outline-none focus:border-transparent focus:ring-2 focus:ring-wa-primary/60 read-only:bg-wa-hover disabled:opacity-60 dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark dark:read-only:bg-wa-head-dark/60" />
                <p className="mt-1.5 text-[11px] text-wa-muted">{isOfficial ? 'El cuerpo aprobado no puede editarse. Ajusta únicamente los valores de sus variables.' : 'Las variables ya fueron reemplazadas. Puedes hacer ajustes solo para este envío.'}</p>
              </div>

              {isOfficial && parameters.length > 0 && (
                <div className="grid gap-2">
                  <h3 className="text-xs font-semibold text-gray-700 dark:text-wa-text-dark">Valores para este envío</h3>
                  {parameters.map((value, index) => (
                    <label key={index} className="grid gap-1 text-xs text-wa-muted sm:grid-cols-[70px_1fr] sm:items-center"><span>{`{{${index + 1}}}`}</span><input value={value} onChange={event => setParameters(current => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} disabled={send.isPending} className="rounded-lg border border-wa-border bg-white px-3 py-2 text-sm text-wa-text dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-wa-text-dark" /></label>
                  ))}
                </div>
              )}

              {isOfficial && (
                <div className={`flex gap-2 rounded-xl border px-3 py-2.5 text-xs ${capabilities?.official_sending_supported ? 'border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-300' : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300'}`}>
                  {capabilities?.official_sending_supported ? <BadgeCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                  <div><p className="font-semibold">{isLoadingCapabilities ? 'Comprobando conexión...' : capabilities?.official_sending_supported ? 'Conexión Meta disponible' : 'La conexión actual no permite plantillas oficiales'}</p>{!isLoadingCapabilities && <p className="mt-0.5">{capabilities?.official_sending_supported ? `${template.official_name} · ${template.official_language} · ${template.official_status}` : capabilities?.reason}</p>}</div>
                </div>
              )}

              {isInteractive && (
                <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 text-xs text-green-800 dark:border-green-900 dark:bg-green-950/30 dark:text-green-300">
                  <p className="font-semibold">{interactiveConfig.title}</p>
                  <p className="mt-1">{template.interactive_type === 'buttons' ? `${interactiveConfig.buttons?.length ?? 0} botones configurados` : `${interactiveConfig.sections?.reduce((total, section) => total + section.rows.length, 0) ?? 0} opciones en ${interactiveConfig.sections?.length ?? 0} secciones`}.</p>
                </div>
              )}

              {usesSafeInteractiveFallback && (
                <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div><p className="font-semibold">Envío compatible con Evolution/Baileys</p><p className="mt-0.5">Esta instancia puede aceptar botones o listas sin entregarlos a WhatsApp. Para garantizar que el cliente vea el mensaje, las opciones se enviarán como un único texto numerado.</p></div>
                </div>
              )}

              {!usesSafeInteractiveFallback && template.interactive_type === 'list' && (
                <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div><p className="font-semibold">Compatibilidad de lista</p><p className="mt-0.5">Si Evolution reporta el error conocido de serialización, todas las opciones se enviarán como un único mensaje numerado.</p></div>
                </div>
              )}

              {unresolvedVariables.length > 0 && (
                <div className="flex gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div><p className="font-semibold">Hay variables sin resolver</p><p className="mt-0.5">Reemplaza {unresolvedVariables.map(variable => `{{${variable}}}`).join(', ')} antes de enviar.</p></div>
                </div>
              )}

              <div>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-xs font-semibold text-gray-700 dark:text-wa-text-dark">Secuencia de envío</h3>
                  <span className="rounded-full bg-green-50 px-2 py-1 text-[10px] font-semibold text-wa-primary-strong dark:bg-green-950/50 dark:text-wa-primary">{stepCount} envío{stepCount === 1 ? '' : 's'}</span>
                </div>
                <ol className="space-y-2">
                  {isInteractive ? (
                    <li className="flex items-center gap-3 rounded-lg border border-wa-border px-3 py-2 dark:border-wa-border-dark">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wa-primary text-[10px] font-bold text-white">1</span>
                      <MessageSquareText className="h-4 w-4 shrink-0 text-wa-primary-strong" />
                      <span className="min-w-0 flex-1"><span className="block text-xs font-medium text-gray-800 dark:text-wa-text-dark">{usesSafeInteractiveFallback ? 'Mensaje compatible con opciones numeradas' : template.interactive_type === 'buttons' ? 'Mensaje con botones' : 'Mensaje con lista'}</span><span className="block truncate text-[10px] text-wa-muted">{interactiveConfig.title}</span></span>
                    </li>
                  ) : text.trim() && (
                    <li className="flex items-center gap-3 rounded-lg border border-wa-border px-3 py-2 dark:border-wa-border-dark">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-wa-primary text-[10px] font-bold text-white">1</span>
                      <MessageSquareText className="h-4 w-4 shrink-0 text-wa-primary-strong" />
                      <span className="min-w-0 flex-1"><span className="block text-xs font-medium text-gray-800 dark:text-wa-text-dark">Mensaje de texto</span><span className="block truncate text-[10px] text-wa-muted">{text}</span></span>
                    </li>
                  )}
                  {attachments.map((attachment, index) => {
                    const Icon = attachmentIcon(attachment)
                    const number = index + (text.trim() ? 2 : 1)
                    return (
                      <li key={attachment.id} className="flex items-center gap-3 rounded-lg border border-wa-border px-3 py-2 dark:border-wa-border-dark">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-violet-600 text-[10px] font-bold text-white">{number}</span>
                        <Icon className="h-4 w-4 shrink-0 text-violet-500" />
                        <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-gray-800 dark:text-wa-text-dark">{attachment.filename}</span><span className="block text-[10px] text-wa-muted">{attachmentKind(attachment)} · {attachment.content_type}</span></span>
                      </li>
                    )
                  })}
                </ol>
              </div>

              {!isOfficial && !isInteractive && <div className="flex gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <p>Cada elemento se encolará como un mensaje independiente y conservará el orden mostrado. Si uno falla, podrá reintentarse sin duplicarlo.</p>
              </div>}

              {send.error && <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">{extractErrorMessage(send.error)}</div>}
            </section>

            <section className="flex min-h-[420px] flex-col border-t border-wa-border bg-wa-chat dark:border-wa-border-dark dark:bg-wa-chat-dark lg:min-h-0 lg:border-l lg:border-t-0">
              <div className="flex items-center gap-2 bg-wa-head px-4 py-3 dark:bg-wa-head-dark">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-wa-primary text-xs font-semibold text-white">{(chat.name || chat.phone || 'C').charAt(0).toUpperCase()}</span>
                <div className="min-w-0"><p className="truncate text-sm font-semibold text-gray-800 dark:text-wa-text-dark">{chat.name || chat.phone || 'Contacto'}</p><p className="text-[10px] text-wa-muted dark:text-wa-muted-dark">Vista aproximada en WhatsApp</p></div>
              </div>
              <div className="flex-1 space-y-2 overflow-y-auto p-4">
                {isInteractive && usesSafeInteractiveFallback ? (
                  <div className="ml-auto w-fit max-w-[88%] rounded-xl rounded-tr-sm bg-wa-out px-3 py-2 text-sm text-wa-text shadow-sm dark:bg-wa-out-dark dark:text-wa-text-dark">
                    <p className="whitespace-pre-wrap break-words"><RichMessage text={safeInteractivePreview} /></p>
                    <p className="mt-1 text-right text-[9px] text-wa-muted dark:text-wa-muted-dark">Vista del mensaje compatible</p>
                  </div>
                ) : isInteractive ? (
                  <>
                    <div className="ml-auto w-full max-w-[88%] overflow-hidden rounded-xl rounded-tr-sm bg-wa-out text-sm text-wa-text shadow-sm dark:bg-wa-out-dark dark:text-wa-text-dark">
                      <div className="px-3 py-2"><p className="font-semibold">{interactiveConfig.title}</p><p className="mt-1 whitespace-pre-wrap break-words"><RichMessage text={text} /></p>{(interactiveConfig.footer || interactiveConfig.footerText) && <p className="mt-2 text-[10px] text-wa-muted dark:text-wa-muted-dark">{interactiveConfig.footer || interactiveConfig.footerText}</p>}</div>
                      {template.interactive_type === 'buttons' ? interactiveConfig.buttons?.map((button, index) => <div key={index} className="border-t border-green-200 px-3 py-2 text-center text-xs font-semibold text-blue-600 dark:border-green-900 dark:text-blue-400">{button.displayText}</div>) : <div className="border-t border-green-200 px-3 py-2 text-center text-xs font-semibold text-blue-600 dark:border-green-900 dark:text-blue-400">{interactiveConfig.buttonText}</div>}
                    </div>
                    {template.interactive_type === 'list' && <div className="ml-auto w-full max-w-[88%] rounded-xl bg-white p-3 shadow-lg dark:bg-wa-head-dark"><p className="mb-2 text-center text-xs font-semibold text-gray-700 dark:text-wa-text-dark">Vista de la lista</p>{interactiveConfig.sections?.map((section, sectionIndex) => <div key={sectionIndex} className="mt-2"><p className="text-[10px] font-semibold uppercase text-wa-muted">{section.title}</p>{section.rows.map((row, rowIndex) => <div key={rowIndex} className="border-b border-wa-border py-2 last:border-0 dark:border-wa-border-dark"><p className="text-xs font-medium text-gray-800 dark:text-wa-text-dark">{row.title}</p>{row.description && <p className="text-[10px] text-wa-muted dark:text-wa-muted-dark">{row.description}</p>}</div>)}</div>)}</div>}
                  </>
                ) : text.trim() && (
                  <div className="ml-auto w-fit max-w-[88%] rounded-xl rounded-tr-sm bg-wa-out px-3 py-2 text-sm text-wa-text shadow-sm dark:bg-wa-out-dark dark:text-wa-text-dark">
                    <p className="whitespace-pre-wrap break-words"><RichMessage text={text} /></p>
                    <p className="mt-1 text-right text-[9px] text-wa-muted dark:text-wa-muted-dark">Vista previa</p>
                  </div>
                )}
                {attachments.map(attachment => <AttachmentBubble key={attachment.id} attachment={attachment} onOpen={setOpenMedia} />)}
                {stepCount === 0 && <p className="py-20 text-center text-xs text-wa-muted">La plantilla no tiene contenido para mostrar.</p>}
              </div>
            </section>
          </div>

          <footer className="flex flex-col-reverse gap-3 border-t border-wa-border bg-white px-5 py-3.5 dark:border-wa-border-dark dark:bg-wa-panel-dark sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1.5 text-[11px] text-wa-muted dark:text-wa-muted-dark">
              {unresolvedVariables.length === 0 && stepCount > 0 ? <CheckCircle2 className="h-4 w-4 text-wa-primary-strong" /> : <AlertTriangle className="h-4 w-4 text-amber-500" />}
              {unresolvedVariables.length === 0 && stepCount > 0 ? 'Contenido revisado y listo para enviar' : 'Corrige los avisos antes de enviar'}
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={closeDialog} disabled={send.isPending} className="rounded-lg px-3 py-2 text-sm font-medium text-wa-muted hover:bg-wa-field disabled:opacity-40 dark:text-wa-muted-dark dark:hover:bg-wa-head-dark">Cancelar</button>
              <button type="button" onClick={confirmSend} disabled={!canSend} className="flex min-w-40 items-center justify-center gap-2 rounded-lg bg-wa-primary px-4 py-2 text-sm font-semibold text-white hover:bg-wa-primary-strong disabled:cursor-not-allowed disabled:opacity-40">
                {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                {send.isPending ? `Encolando ${stepCount} elementos...` : isOfficial ? 'Enviar plantilla oficial' : usesSafeInteractiveFallback ? 'Enviar opciones' : isInteractive ? template.interactive_type === 'buttons' ? 'Enviar botones' : 'Enviar lista' : `Enviar ${stepCount} elemento${stepCount === 1 ? '' : 's'}`}
              </button>
            </div>
          </footer>
        </div>
      </div>
      {openMedia && <MediaLightbox src={openMedia.src} kind={openMedia.kind} alt={openMedia.alt} onClose={() => setOpenMedia(null)} />}
    </>
  )
}
