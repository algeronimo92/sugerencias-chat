import { useState } from 'react'
import { Loader2, Plus, Tag as TagIcon, X } from 'lucide-react'
import type { Chat } from '../types'
import { useMe } from '../hooks/useAuth'
import { useAssignTag, useCreateTag, useRemoveTag, useTags } from '../hooks/useLeadMeta'
import { extractErrorMessage } from '../utils/errors'

export function LeadTagsPanel({ chat }: { chat: Chat }) {
  const { data: me } = useMe()
  const { data: tags = [] } = useTags()
  const { mutate: assign, isPending: isAssigning } = useAssignTag(chat.chat_id)
  const { mutate: remove, isPending: isRemoving } = useRemoveTag(chat.chat_id)
  const { mutate: create, isPending: isCreating } = useCreateTag()
  const [selectedTagId, setSelectedTagId] = useState('')
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#16a34a')
  const [error, setError] = useState<string | null>(null)
  const assignedIds = new Set(chat.tags.map((tag) => tag.id))
  const available = tags.filter((tag) => !assignedIds.has(tag.id))

  function handleAssign() {
    if (!selectedTagId) return
    setError(null)
    assign(Number(selectedTagId), {
      onSuccess: () => setSelectedTagId(''),
      onError: (err) => setError(extractErrorMessage(err)),
    })
  }

  function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    const name = newName.trim()
    if (!name) return
    setError(null)
    create(
      { name, color: newColor },
      {
        onSuccess: (tag) => {
          setNewName('')
          assign(tag.id, { onError: (err) => setError(extractErrorMessage(err)) })
        },
        onError: (err) => setError(extractErrorMessage(err)),
      }
    )
  }

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-3 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <div className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
        <TagIcon className="h-3.5 w-3.5" /> Etiquetas
      </div>
      <div className="flex flex-wrap gap-1.5">
        {chat.tags.map((tag) => (
          <span key={tag.id} className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-medium text-white" style={{ backgroundColor: tag.color }}>
            {tag.name}
            <button
              type="button"
              onClick={() => remove(tag.id, { onError: (err) => setError(extractErrorMessage(err)) })}
              disabled={isRemoving}
              aria-label={`Quitar ${tag.name}`}
              className="rounded-full hover:bg-black/20 disabled:opacity-50"
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {chat.tags.length === 0 && <span className="text-xs text-gray-400">Sin etiquetas</span>}
      </div>

      {available.length > 0 && (
        <div className="mt-2 flex gap-1.5">
          <select
            value={selectedTagId}
            onChange={(event) => setSelectedTagId(event.target.value)}
            className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          >
            <option value="">Agregar etiqueta…</option>
            {available.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
          </select>
          <button type="button" onClick={handleAssign} disabled={!selectedTagId || isAssigning} className="rounded-md bg-green-600 px-2 text-white hover:bg-green-700 disabled:opacity-40">
            {isAssigning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
          </button>
        </div>
      )}

      {me?.role === 'admin' && (
        <form onSubmit={handleCreate} className="mt-2 flex items-center gap-1.5 border-t border-gray-100 pt-2 dark:border-gray-700">
          <input
            type="color"
            value={newColor}
            onChange={(event) => setNewColor(event.target.value)}
            // El border-radius del <input> no alcanza al swatch de color nativo
            // (vive en un pseudo-elemento propio del navegador), así que hay
            // que redondear ::-webkit-color-swatch (Chrome/Edge) y
            // ::-moz-color-swatch (Firefox) por separado.
            className="h-7 w-8 cursor-pointer rounded-lg border-0 bg-transparent p-0 [&::-moz-color-swatch]:rounded-lg [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:rounded-lg [&::-webkit-color-swatch-wrapper]:p-0"
            aria-label="Color"
          />
          <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Nueva etiqueta" className="min-w-0 flex-1 rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs dark:border-gray-700 dark:bg-gray-900 dark:text-gray-200" />
          <button type="submit" disabled={!newName.trim() || isCreating} className="rounded-md border border-gray-200 px-2 py-1.5 text-xs text-gray-500 hover:text-green-600 disabled:opacity-40 dark:border-gray-700">
            {isCreating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Crear'}
          </button>
        </form>
      )}
      {error && <p className="mt-2 text-xs text-red-500">{error}</p>}
    </div>
  )
}
