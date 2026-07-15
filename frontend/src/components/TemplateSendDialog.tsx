import { useState } from 'react'
import { FileText, Loader2, Send, X } from 'lucide-react'
import type { Chat, MessageTemplate } from '../types'
import { useSendTemplate } from '../hooks/useMessages'
import { extractErrorMessage } from '../utils/errors'
import { resolveMediaUrl } from '../utils/message'
import { renderTemplate } from '../utils/templates'

export function TemplateSendDialog({ chat, template, onClose }: { chat: Chat; template: MessageTemplate; onClose: () => void }) {
  const [text, setText] = useState(renderTemplate(template, chat))
  const send = useSendTemplate(chat.chat_id)
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}><div onClick={e=>e.stopPropagation()} className="w-full max-w-lg overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-900">
    <div className="flex items-center justify-between border-b px-4 py-3 dark:border-gray-800"><div><h2 className="text-sm font-semibold dark:text-white">Enviar plantilla multimedia</h2><p className="text-xs text-gray-400">{template.name}</p></div><button onClick={onClose}><X className="h-4 w-4 text-gray-400"/></button></div>
    <div className="max-h-[65vh] space-y-4 overflow-y-auto p-4"><div><label className="mb-1 block text-xs font-medium text-gray-500">Mensaje</label><textarea rows={5} value={text} onChange={e=>setText(e.target.value)} className="w-full resize-none rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"/></div>
      <div><p className="mb-2 text-xs font-medium text-gray-500">Adjuntos ({template.attachments.length})</p><div className="grid grid-cols-2 gap-2">{template.attachments.map(attachment=>{const url=resolveMediaUrl(attachment.media_url);return <div key={attachment.id} className="overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700">{attachment.content_type.startsWith('image/')?<img src={url??''} alt={attachment.filename} className="h-28 w-full object-cover"/>:attachment.content_type.startsWith('video/')?<video src={url??''} className="h-28 w-full bg-black object-contain"/>:<div className="flex h-28 items-center justify-center bg-gray-50 dark:bg-gray-800"><FileText className="h-8 w-8 text-gray-400"/></div>}<p className="truncate px-2 py-1.5 text-xs text-gray-500">{attachment.filename}</p></div>})}</div></div>
      <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-950/30 dark:text-amber-400">Se enviará primero el texto y después los archivos en el orden mostrado.</p>{send.error&&<p className="text-xs text-red-500">{extractErrorMessage(send.error)}</p>}</div>
    <div className="flex justify-end gap-2 border-t px-4 py-3 dark:border-gray-800"><button onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-gray-500">Cancelar</button><button onClick={()=>send.mutate({templateId:template.id,text},{onSuccess:onClose})} disabled={send.isPending||(!text.trim()&&!template.attachments.length)} className="flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-50">{send.isPending?<Loader2 className="h-4 w-4 animate-spin"/>:<Send className="h-4 w-4"/>}{send.isPending?'Enviando...':'Confirmar envío'}</button></div>
  </div></div>
}
