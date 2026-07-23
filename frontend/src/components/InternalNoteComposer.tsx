import { useMemo, useRef, useState } from 'react'
import { AtSign, Loader2, Send, X } from 'lucide-react'
import type { SellerOption } from '../types'
import { useCreateInternalNote } from '../hooks/useInternalNotes'
import { useSellers } from '../hooks/useUsers'
import { extractErrorMessage } from '../utils/errors'

interface Props {
  chatId: string
  onCancel: () => void
  onCreated?: () => void
}

interface MentionQuery {
  start: number
  query: string
}

function findMentionQuery(value: string, cursor: number): MentionQuery | null {
  const beforeCursor = value.slice(0, cursor)
  const match = /(?:^|\s)@([^\s@]*)$/.exec(beforeCursor)
  if (!match) return null
  return { start: beforeCursor.lastIndexOf('@'), query: match[1].trim().toLowerCase() }
}

export function InternalNoteComposer({ chatId, onCancel, onCreated }: Props) {
  const { data: users = [] } = useSellers()
  const createNote = useCreateInternalNote(chatId)
  const [content, setContent] = useState('')
  const [mentionedUsers, setMentionedUsers] = useState<SellerOption[]>([])
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null)
  const [activeIndex, setActiveIndex] = useState(0)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const suggestions = useMemo(() => {
    if (!mentionQuery) return []
    return users
      .filter(user => !mentionedUsers.some(item => item.id === user.id))
      .filter(user => user.name.toLowerCase().includes(mentionQuery.query))
      .slice(0, 6)
  }, [mentionQuery, mentionedUsers, users])

  function updateMentionQuery(value: string, cursor: number) {
    setMentionQuery(findMentionQuery(value, cursor))
    setActiveIndex(0)
  }

  function selectMention(user: SellerOption) {
    const textarea = textareaRef.current
    if (!textarea || !mentionQuery) return
    const cursor = textarea.selectionStart
    const inserted = `@${user.name} `
    const next = content.slice(0, mentionQuery.start) + inserted + content.slice(cursor)
    const nextCursor = mentionQuery.start + inserted.length
    setContent(next)
    setMentionedUsers(current => [...current, user])
    setMentionQuery(null)
    requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(nextCursor, nextCursor)
    })
  }

  function removeMention(user: SellerOption) {
    setMentionedUsers(current => current.filter(item => item.id !== user.id))
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    const text = content.trim()
    if (!text || createNote.isPending) return
    createNote.mutate(
      { content: text, mentionedUserIds: mentionedUsers.map(user => user.id) },
      { onSuccess: () => { setContent(''); setMentionedUsers([]); onCreated?.() } },
    )
  }

  return (
    <form onSubmit={handleSubmit} className="border-t border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950/30">
      <div className="mb-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-800 dark:text-amber-300">
          <AtSign className="h-3.5 w-3.5" /> Nota interna · Solo equipo
        </div>
        <button type="button" onClick={onCancel} className="rounded p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-400 dark:hover:bg-amber-900/40" title="Volver a WhatsApp"><X className="h-4 w-4" /></button>
      </div>

      {mentionedUsers.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {mentionedUsers.map(user => (
            <span key={user.id} className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-1 text-[11px] font-medium text-violet-700 dark:bg-violet-950/60 dark:text-violet-300">
              @{user.name}
              <button type="button" onClick={() => removeMention(user)} aria-label={`Quitar mención a ${user.name}`}><X className="h-3 w-3" /></button>
            </span>
          ))}
        </div>
      )}

      {createNote.error && <p className="mb-2 text-xs text-red-600 dark:text-red-400">{extractErrorMessage(createNote.error)}</p>}

      <div className="flex items-end gap-2">
        <div className="relative flex-1">
          {suggestions.length > 0 && (
            <div className="absolute bottom-full left-0 z-40 mb-2 w-72 overflow-hidden rounded-xl border border-wa-border bg-white p-1 shadow-xl dark:border-wa-border-dark dark:bg-wa-head-dark">
              {suggestions.map((user, index) => (
                <button
                  key={user.id}
                  type="button"
                  onMouseDown={event => event.preventDefault()}
                  onClick={() => selectMention(user)}
                  onMouseEnter={() => setActiveIndex(index)}
                  className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left ${index === activeIndex ? 'bg-violet-50 dark:bg-violet-950/40' : 'hover:bg-wa-hover dark:hover:bg-wa-active-dark'}`}
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-100 text-xs font-semibold text-violet-700 dark:bg-violet-950 dark:text-violet-300">{user.name.charAt(0).toUpperCase()}</span>
                  <span><span className="block text-sm font-medium text-gray-800 dark:text-wa-text-dark">{user.name}</span><span className="block text-[10px] text-wa-muted">{user.role}</span></span>
                </button>
              ))}
            </div>
          )}
          <textarea
            ref={textareaRef}
            autoFocus
            value={content}
            maxLength={5000}
            rows={2}
            placeholder="Escribe una nota privada... Usa @ para mencionar"
            onChange={event => {
              setContent(event.target.value)
              updateMentionQuery(event.target.value, event.target.selectionStart)
            }}
            onClick={event => updateMentionQuery(content, event.currentTarget.selectionStart)}
            onKeyDown={event => {
              if (suggestions.length > 0) {
                if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex(index => (index + 1) % suggestions.length); return }
                if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex(index => (index - 1 + suggestions.length) % suggestions.length); return }
                if ((event.key === 'Enter' || event.key === 'Tab') && !event.shiftKey) { event.preventDefault(); selectMention(suggestions[activeIndex]); return }
                if (event.key === 'Escape') { event.preventDefault(); setMentionQuery(null); return }
              }
              if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) handleSubmit(event)
            }}
            className="max-h-32 w-full resize-none rounded-lg border border-amber-300 bg-white px-3 py-2 text-sm text-wa-text outline-none placeholder:text-wa-muted focus:border-transparent focus:ring-2 focus:ring-amber-400 dark:border-amber-800 dark:bg-wa-panel-dark dark:text-wa-text-dark"
          />
        </div>
        <button type="submit" disabled={!content.trim() || createNote.isPending} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-amber-500 text-white hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-40" title="Guardar nota interna">
          {createNote.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </button>
      </div>
      <p className="mt-1.5 text-[10px] text-amber-700/70 dark:text-amber-400/70">No se enviará al cliente · Ctrl+Enter para guardar</p>
    </form>
  )
}
