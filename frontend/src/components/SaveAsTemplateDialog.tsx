import { useState } from 'react'
import { Loader2, X } from 'lucide-react'
import { useCreatePersonalTemplate } from '../hooks/useTemplates'
import { extractErrorMessage } from '../utils/errors'

export function SaveAsTemplateDialog({ content, onClose }: { content: string; onClose: () => void }) {
  const [name, setName] = useState(content.slice(0, 42))
  const [shortcut, setShortcut] = useState('')
  const [error, setError] = useState<string | null>(null)
  const create = useCreatePersonalTemplate()
  function submit(event: React.FormEvent) {
    event.preventDefault(); setError(null)
    const normalizedName = name.trim()
    const normalizedShortcut = shortcut.trim().replace(/^\/+/, '').toLowerCase()
    if (!normalizedName) { setError('El nombre es obligatorio'); return }
    if (normalizedName.length > 120) { setError('El nombre admite máximo 120 caracteres'); return }
    if (!content.trim() || content.trim().length > 4096) { setError('El contenido debe tener entre 1 y 4096 caracteres'); return }
    if (normalizedShortcut && (normalizedShortcut.length > 50 || !/^[a-z0-9_-]+$/.test(normalizedShortcut))) { setError('El atajo solo admite letras, números, - y _ (máximo 50)'); return }
    create.mutate({ name: normalizedName, content, shortcut: normalizedShortcut || null }, {
      onSuccess: onClose,
      onError: err => setError(extractErrorMessage(err)),
    })
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}><form onSubmit={submit} onClick={event => event.stopPropagation()} className="w-full max-w-md rounded-xl border border-wa-border bg-white shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark">
    <div className="flex items-center justify-between border-b px-4 py-3 dark:border-wa-border-dark"><h2 className="text-sm font-semibold dark:text-white">Guardar como plantilla personal</h2><button type="button" onClick={onClose}><X className="h-4 w-4 text-wa-muted"/></button></div>
    <div className="space-y-3 p-4"><div><label className="mb-1 block text-xs text-wa-muted">Nombre</label><input required maxLength={120} value={name} onChange={e=>setName(e.target.value)} className="w-full rounded-lg border px-3 py-2 text-sm dark:border-wa-border-dark dark:bg-wa-head-dark dark:text-white"/></div><div><label className="mb-1 block text-xs text-wa-muted">Atajo opcional</label><div className="flex rounded-lg border dark:border-wa-border-dark"><span className="px-3 py-2 text-sm text-wa-muted">/</span><input maxLength={50} pattern="[a-zA-Z0-9_-]*" value={shortcut} onChange={e=>setShortcut(e.target.value.replace(/\s/g,''))} className="min-w-0 flex-1 bg-transparent py-2 pr-3 text-sm outline-none dark:text-white" placeholder="respuesta"/></div></div><div><label className="mb-1 block text-xs text-wa-muted">Contenido</label><p className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg bg-wa-hover p-3 text-sm text-gray-700 dark:bg-wa-head-dark dark:text-wa-text-dark">{content}</p></div>{error&&<p className="text-xs text-red-500">{error}</p>}</div>
    <div className="flex justify-end gap-2 border-t px-4 py-3 dark:border-wa-border-dark"><button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-sm text-wa-muted">Cancelar</button><button disabled={create.isPending} className="flex items-center gap-2 rounded-lg bg-wa-primary px-3 py-2 text-sm font-medium text-white disabled:opacity-50">{create.isPending&&<Loader2 className="h-4 w-4 animate-spin"/>}Guardar</button></div>
  </form></div>
}
