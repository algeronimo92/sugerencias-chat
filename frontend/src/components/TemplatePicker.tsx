import { useMemo, useState } from 'react'
import { BadgeCheck, Clock3, FileText, History, Search, Star, UserRound } from 'lucide-react'
import type { Chat, MessageTemplate } from '../types'
import { useRecordTemplateUse, useTemplates, useToggleTemplateFavorite } from '../hooks/useTemplates'
import { renderTemplate } from '../utils/templates'

interface Props { chat: Chat; sentMessages: string[]; onSelect: (text: string) => void; onSaveHistory: (text: string) => void; onSendMultimedia: (template: MessageTemplate) => void }

export function TemplatePicker({ chat, sentMessages, onSelect, onSaveHistory, onSendMultimedia }: Props) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const { data = [] } = useTemplates()
  const favorite = useToggleTemplateFavorite()
  const recordUse = useRecordTemplateUse()
  const relevant = useMemo(() => data.filter(t =>
    (t.template_type === 'internal' || t.official_status === 'APPROVED') &&
    (!t.stage || t.stage === chat.stage) &&
    (!t.service || t.service.toLowerCase() === chat.servicio_interes?.toLowerCase()) &&
    `${t.name} ${t.shortcut} ${t.content}`.toLowerCase().includes(search.toLowerCase())
  ), [data, chat.stage, chat.servicio_interes, search])
  const favorites = relevant.filter(t => t.is_favorite)
  const recent = relevant.filter(t => t.last_used_at && !t.is_favorite).sort((a,b) => Date.parse(b.last_used_at!) - Date.parse(a.last_used_at!)).slice(0, 5)
  const priorityIds = new Set([...favorites, ...recent].map(t => t.id))
  const remaining = relevant.filter(t => !priorityIds.has(t.id)).sort((a,b) => Number(!!b.stage)-Number(!!a.stage))

  function choose(template: MessageTemplate) {
    if (template.template_type === 'official' || template.interactive_type !== 'none' || template.attachments.length) onSendMultimedia(template)
    else { onSelect(renderTemplate(template, chat)); recordUse.mutate(template.id) }
    setOpen(false); setSearch('')
  }
  function row(template: MessageTemplate) {
    return <div key={template.id} className="group flex items-center rounded-lg hover:bg-wa-hover dark:hover:bg-wa-active-dark">
      <button type="button" onClick={()=>choose(template)} className="min-w-0 flex-1 px-3 py-2 text-left"><p className="flex items-center gap-1.5 text-sm font-medium text-wa-text dark:text-white">{template.visibility==='personal'&&<UserRound className="h-3 w-3 text-violet-500"/>}{template.template_type==='official'&&<BadgeCheck className="h-3.5 w-3.5 text-blue-500"/>}{template.name}{template.template_type==='official'&&<span className="rounded bg-blue-50 px-1.5 py-0.5 text-[9px] text-blue-600 dark:bg-blue-950/40">Oficial</span>}{template.interactive_type!=='none'&&<span className="rounded bg-green-50 px-1.5 py-0.5 text-[9px] text-wa-primary-strong dark:bg-green-950/40">{template.interactive_type==='buttons'?'Botones':'Lista'}</span>}{template.attachments.length>0&&<span className="rounded bg-violet-50 px-1.5 py-0.5 text-[9px] text-violet-600 dark:bg-violet-950/40">{template.attachments.length} archivo{template.attachments.length===1?'':'s'}</span>}</p><p className="truncate text-xs text-wa-muted dark:text-wa-muted-dark">{template.shortcut?`/${template.shortcut} · `:''}{template.content}</p></button>
      <button type="button" title={template.is_favorite?'Quitar de favoritos':'Agregar a favoritos'} onClick={()=>favorite.mutate({id:template.id,isFavorite:!template.is_favorite})} className="mr-2 rounded p-1.5 hover:bg-wa-field dark:hover:bg-gray-600"><Star className={`h-4 w-4 ${template.is_favorite?'fill-amber-400 text-amber-400':'text-gray-300 dark:text-wa-muted-dark'}`}/></button>
    </div>
  }
  function section(title: string, icon: typeof Star, items: MessageTemplate[]) {
    if (!items.length) return null; const Icon=icon
    return <section><div className="flex items-center gap-1.5 px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-wa-muted"><Icon className="h-3 w-3"/>{title}</div>{items.map(row)}</section>
  }
  return <div className="relative"><button type="button" title="Respuestas rápidas y plantillas oficiales" onClick={()=>setOpen(!open)} className="flex h-9 w-9 items-center justify-center rounded-lg text-wa-muted hover:bg-wa-field dark:text-wa-muted-dark dark:hover:bg-wa-head-dark"><FileText className="h-4 w-4"/></button>
    {open&&<div className="absolute bottom-11 left-0 z-30 w-96 max-w-[calc(100vw-2rem)] rounded-xl border border-wa-border bg-white p-2 shadow-xl dark:border-wa-border-dark dark:bg-wa-head-dark"><div className="flex items-center gap-2 rounded-lg bg-wa-field px-2 dark:bg-wa-panel-dark"><Search className="h-4 w-4 text-wa-muted"/><input autoFocus value={search} onChange={e=>setSearch(e.target.value)} placeholder="Buscar respuesta o /atajo" className="w-full bg-transparent py-2 text-sm text-gray-800 outline-none dark:text-wa-text-dark"/></div>
      <div className="mt-1 max-h-80 overflow-auto">{section('Favoritas',Star,favorites)}{!search&&section('Usadas recientemente',Clock3,recent)}{section(search?'Resultados':'Todas las plantillas',FileText,remaining)}
        {!search&&sentMessages.length>0&&<section><div className="flex items-center gap-1.5 px-3 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-wa-muted"><History className="h-3 w-3"/>Mensajes enviados recientemente</div>{sentMessages.map((message,index)=><div key={`${message}-${index}`} className="group flex items-center rounded-lg hover:bg-wa-hover dark:hover:bg-wa-active-dark"><button type="button" onClick={()=>{onSelect(message);setOpen(false)}} className="min-w-0 flex-1 px-3 py-2 text-left text-xs text-gray-600 dark:text-gray-300"><p className="line-clamp-2">{message}</p></button><button type="button" title="Guardar como plantilla" onClick={()=>{onSaveHistory(message);setOpen(false)}} className="mr-2 rounded p-1.5 text-wa-muted hover:text-wa-primary-strong"><FileText className="h-4 w-4"/></button></div>)}</section>}
        {relevant.length===0&&sentMessages.length===0&&<p className="p-4 text-center text-sm text-wa-muted">Sin respuestas rápidas</p>}</div></div>}
  </div>
}
