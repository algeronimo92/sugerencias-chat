import { Loader2, Plus, X } from 'lucide-react'
import { TagChip } from '../../../shared/ui/TagChip'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { Select } from '../../../shared/ui/Input'
import { PanelSection } from '../../../shared/ui/PanelSection'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { useMe } from '../../auth/public/queries'
import type { Chat } from '../types'
import { useAssignTag, useRemoveTag } from '../hooks/useLeadMeta'
import { useCreateTag, useTags } from '../../catalogs/public/useTags'
export function LeadTagsPanel({ chat }: { chat: Chat }) {
  const { data: me } = useMe()
  const { data: tags = [] } = useTags()
  const { mutate: assign, isPending: isAssigning } = useAssignTag(chat.chat_id)
  const removeTag = useRemoveTag(chat.chat_id)
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
      onSuccess: () => { setSelectedTagId(''); toast.success('Etiqueta asignada') },
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
          assign(tag.id, { onSuccess: () => toast.success('Etiqueta creada y asignada'), onError: (err) => setError(extractErrorMessage(err)) })
        },
        onError: (err) => setError(extractErrorMessage(err)),
      }
    )
  }

  return (
    <PanelSection title="Etiquetas" count={chat.tags.length} storageKey="ficha-seccion-etiquetas">
      <div className="flex flex-wrap gap-1.5">
        {chat.tags.map((tag) => {
          const isRemoving = removeTag.isPending && removeTag.variables === tag.id
          return (
          <TagChip key={tag.id} name={tag.name} color={tag.color} size="md">
            <button
              type="button"
              onClick={() => removeTag.mutate(tag.id, {
                onSuccess: () => toast.success('Etiqueta quitada del lead', {
                  description: tag.name,
                  action: { label: 'Deshacer', onClick: () => assign(tag.id, { onError: (err) => toast.error(extractErrorMessage(err)) }) },
                }),
                onError: (err) => setError(extractErrorMessage(err)),
              })}
              disabled={removeTag.isPending}
              aria-label={isRemoving ? `Quitando ${tag.name}` : `Quitar ${tag.name}`}
              aria-busy={isRemoving}
              className="-mr-1 flex h-5 w-5 items-center justify-center rounded-full text-fg-muted outline-none hover:bg-selected hover:text-fg focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60"
            >
              {isRemoving ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
            </button>
          </TagChip>
          )
        })}
        {chat.tags.length === 0 && <span className="text-sm text-fg-muted">Sin etiquetas</span>}
      </div>

      {available.length > 0 && (
        <div className="mt-2 flex gap-1.5">
          <Select
            value={selectedTagId}
            onChange={(event) => setSelectedTagId(event.target.value)}
            aria-label="Agregar etiqueta"
            className="min-w-0 flex-1"
          >
            <option value="">Agregar etiqueta…</option>
            {available.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
          </Select>
          <Button size="icon" onClick={handleAssign} disabled={!selectedTagId} loading={isAssigning} aria-label="Asignar etiqueta">
            <Plus className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
      )}

      {me?.role === 'admin' && (
        <form onSubmit={handleCreate} className="mt-2 flex items-center gap-1.5">
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
          <input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Nueva etiqueta" aria-label="Nombre de la nueva etiqueta" className="min-w-0 flex-1 rounded-lg border border-line-control bg-surface px-2.5 py-1.5 text-sm text-fg outline-none focus-visible:ring-2 focus-visible:ring-ring" />
          <Button type="submit" variant="secondary" size="sm" disabled={!newName.trim()} loading={isCreating}>Crear</Button>
        </form>
      )}
      {error && <p role="alert" className="mt-2 text-xs text-danger-fg">{error}</p>}
    </PanelSection>
  )
}
