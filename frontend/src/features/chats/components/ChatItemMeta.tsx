import { TagChip } from '../../../shared/ui/TagChip'
import { useLeadStageCatalog } from '../../leads/public/useLeadStages'
import type { Chat } from '../../leads/types'

const VISIBLE_TAGS = 2

/** Etapa, vendedora y etiquetas en una línea de 12 px bajo el último mensaje:
 *  lo que antes obligaba a abrir el chat para saber en qué estaba. */
export function ChatItemMeta({ chat }: { chat: Chat }) {
  const stageCatalog = useLeadStageCatalog()
  const stage = chat.stage ? stageCatalog.get(chat.stage) : null
  const hiddenTags = chat.tags.length - VISIBLE_TAGS

  return (
    <div className="mt-1.5 flex min-w-0 items-center gap-1.5 overflow-hidden text-xs text-fg-muted">
      {stage && (
        <>
          <span className="flex shrink-0 items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: stage.color }} aria-hidden="true" />
            <span className="max-w-28 truncate">{stage.name}</span>
          </span>
          <span aria-hidden="true">·</span>
        </>
      )}
      <span className="max-w-24 shrink-0 truncate">{chat.vendedor ?? 'Sin asignar'}</span>
      {chat.tags.slice(0, VISIBLE_TAGS).map((tag) => (
        <TagChip key={tag.id} name={tag.name} color={tag.color} className="max-w-24 shrink" />
      ))}
      {hiddenTags > 0 && <span className="shrink-0">+{hiddenTags}</span>}
    </div>
  )
}
