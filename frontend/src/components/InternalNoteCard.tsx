import { useState } from 'react'
import { Check, Loader2, MessageSquareLock, Pencil, Trash2, X } from 'lucide-react'
import type { InternalNote } from '../types'
import { useDeleteInternalNote, useUpdateInternalNote } from '../hooks/useInternalNotes'
import { extractErrorMessage } from '../utils/errors'
import { formatMessageTime } from '../utils/message'

interface Props {
  chatId: string
  note: InternalNote
  canManage: boolean
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function NoteContent({ note }: { note: InternalNote }) {
  if (!note.mentions.length) return <>{note.content}</>
  const names = note.mentions.map(mention => mention.user_name).sort((a, b) => b.length - a.length)
  const regex = new RegExp(`(@(?:${names.map(escapeRegex).join('|')}))`, 'gi')
  const mentionedNames = new Set(names.map(name => name.toLowerCase()))
  return <>{note.content.split(regex).map((part, index) =>
    part.startsWith('@') && mentionedNames.has(part.slice(1).toLowerCase())
      ? <span key={index} className="rounded bg-violet-100 px-1 font-semibold text-violet-700 dark:bg-violet-950/70 dark:text-violet-300">{part}</span>
      : <span key={index}>{part}</span>
  )}</>
}

export function InternalNoteCard({ chatId, note, canManage }: Props) {
  const update = useUpdateInternalNote(chatId)
  const remove = useDeleteInternalNote(chatId)
  const [editing, setEditing] = useState(false)
  const [content, setContent] = useState(note.content)

  function save() {
    const text = content.trim()
    if (!text || update.isPending) return
    update.mutate(
      { id: note.id, content: text, mentionedUserIds: note.mentions.map(mention => mention.user_id) },
      { onSuccess: () => setEditing(false) },
    )
  }

  function deleteNote() {
    if (!window.confirm('¿Eliminar esta nota interna?')) return
    remove.mutate(note.id)
  }

  return (
    <div className="flex justify-center py-1">
      <article className="w-full max-w-[85%] rounded-xl border border-amber-300 bg-amber-50 px-3.5 py-3 text-sm text-amber-950 shadow-sm dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
        <header className="mb-2 flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-200 text-amber-800 dark:bg-amber-900 dark:text-amber-200"><MessageSquareLock className="h-3.5 w-3.5" /></span>
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold">{note.author_name}</p>
              <p className="text-[10px] font-medium uppercase tracking-wide text-amber-700/70 dark:text-amber-400/80">Nota interna · Solo equipo</p>
            </div>
          </div>
          {canManage && !editing && (
            <div className="flex shrink-0 items-center gap-0.5">
              <button type="button" onClick={() => { setContent(note.content); setEditing(true) }} title="Editar nota" className="rounded p-1 text-amber-700/60 hover:bg-amber-100 hover:text-amber-800 dark:text-amber-400/70 dark:hover:bg-amber-900/50"><Pencil className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={deleteNote} disabled={remove.isPending} title="Eliminar nota" className="rounded p-1 text-red-500/70 hover:bg-red-100 hover:text-red-700 dark:text-red-400/80 dark:hover:bg-red-950/50"><Trash2 className="h-3.5 w-3.5" /></button>
            </div>
          )}
        </header>

        {editing ? (
          <div>
            <textarea autoFocus value={content} maxLength={5000} rows={3} onChange={event => setContent(event.target.value)} className="w-full resize-y rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-gray-900 outline-none focus:ring-2 focus:ring-amber-400 dark:border-amber-800 dark:bg-gray-900 dark:text-gray-100" />
            {update.error && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{extractErrorMessage(update.error)}</p>}
            <div className="mt-2 flex justify-end gap-1.5">
              <button type="button" onClick={() => setEditing(false)} className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-900/40"><X className="h-3.5 w-3.5" />Cancelar</button>
              <button type="button" onClick={save} disabled={!content.trim() || update.isPending} className="flex items-center gap-1 rounded-md bg-amber-500 px-2 py-1 text-xs font-medium text-white hover:bg-amber-600 disabled:opacity-40">{update.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Guardar</button>
            </div>
          </div>
        ) : (
          <p className="whitespace-pre-wrap break-words leading-relaxed"><NoteContent note={note} /></p>
        )}

        <footer className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[10px] text-amber-700/60 dark:text-amber-400/70">
          <span>{note.mentions.length > 0 ? `Mencionó a ${note.mentions.map(item => item.user_name).join(', ')}` : 'Sin menciones'}</span>
          <span>{note.is_edited && 'Editada · '}{formatMessageTime(note.updated_at)}</span>
        </footer>
      </article>
    </div>
  )
}
