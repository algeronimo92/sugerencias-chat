import { Tag, Trash2, UserPlus, X } from 'lucide-react'
import { useState } from 'react'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { ConfirmDialog } from '../../../shared/ui/ConfirmDialog'
import { Input } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { contactsLabel, splitTags } from '../domain/selection'
import { useChangeContactTags, useDeleteContacts, usePromoteContacts } from '../hooks/useContacts'

interface Props {
  ids: string[]
  isAdmin: boolean
  onDone: () => void
}

/** Acciones sobre lo seleccionado, fija abajo para no perderla al bajar. */
export function ContactsBulkBar({ ids, isAdmin, onDone }: Props) {
  const tags = useChangeContactTags()
  const remove = useDeleteContacts()
  const promote = usePromoteContacts()
  const [tagText, setTagText] = useState('')
  const busy = tags.isPending || remove.isPending || promote.isPending
  const label = contactsLabel(ids.length)

  function addTags() {
    const add = splitTags(tagText)
    if (add.length === 0) return
    tags.mutate({ ids, add, remove: [] }, {
      onSuccess: () => { toast.success(`Etiqueta agregada a ${label}`); setTagText('') },
      onError: err => toast.error('No se pudieron etiquetar', { description: extractErrorMessage(err) }),
    })
  }

  function promoteAll() {
    promote.mutate(ids, {
      onSuccess: ({ promoted, failed }) => {
        toast.success(`${contactsLabel(promoted)} pasaron a lead`, {
          description: failed ? `${failed} sin número no se pudieron pasar` : undefined,
        })
        onDone()
      },
      onError: err => toast.error('No se pudieron pasar a lead', { description: extractErrorMessage(err) }),
    })
  }

  function deleteAll() {
    remove.mutate(ids, {
      onSuccess: ({ count }) => { toast.success(`${contactsLabel(count)} borrados de la agenda`); onDone() },
      onError: err => toast.error('No se pudieron borrar', { description: extractErrorMessage(err) }),
    })
  }

  return (
    <div role="region" aria-label="Acciones sobre los seleccionados" className="fixed inset-x-0 bottom-16 z-40 px-4 md:bottom-4">
      <div className="mx-auto flex max-w-[1100px] flex-col gap-2 rounded-xl border border-wa-border bg-white p-3 shadow-lg sm:flex-row sm:items-center dark:border-wa-border-dark dark:bg-wa-panel-dark">
        <span className="text-sm font-medium text-wa-text dark:text-wa-text-dark">{label} seleccionados</span>
        <form className="flex flex-1 gap-2" onSubmit={event => { event.preventDefault(); addTags() }}>
          <Input value={tagText} onChange={event => setTagText(event.target.value)} placeholder="Etiqueta" aria-label="Etiqueta para los seleccionados" className="h-9" />
          <Button type="submit" variant="secondary" disabled={busy || !tagText.trim()}>
            <Tag className="h-4 w-4" aria-hidden="true" />
            Etiquetar
          </Button>
        </form>
        {isAdmin && (
          <>
            <ConfirmDialog
              title={`¿Pasar ${label} a lead?`}
              description="Se crea un lead por cada uno en la primera etapa del embudo y corren las automatizaciones de lead nuevo. Los que ya son lead no cambian."
              confirmLabel="Pasar a lead"
              confirmVariant="primary"
              disabled={busy}
              onConfirm={promoteAll}
            >
              <Button variant="secondary" disabled={busy}>
                <UserPlus className="h-4 w-4" aria-hidden="true" />
                Pasar a lead
              </Button>
            </ConfirmDialog>
            <ConfirmDialog
              title={`¿Borrar ${label} de la agenda?`}
              description="Sus leads y chats, si los tienen, no se tocan. No se puede deshacer."
              confirmLabel="Borrar"
              disabled={busy}
              onConfirm={deleteAll}
            >
              <Button variant="danger" disabled={busy}>
                <Trash2 className="h-4 w-4" aria-hidden="true" />
                Borrar
              </Button>
            </ConfirmDialog>
          </>
        )}
        <Button variant="ghost" size="icon" onClick={onDone} aria-label="Quitar selección">
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  )
}
