import { AlertCircle, ArrowRight, Inbox, Loader2, Search } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '../../../shared/ui/Button'
import { Input } from '../../../shared/ui/Input'
import { extractErrorMessage } from '../../../shared/utils/errors'
import { displayName } from '../utils/chat'
import type { Chat } from '../types'
import { kanbanColumns } from '../domain/leadStageMeta'
import { useTags } from '../../catalogs/public/useTags'
import { useLeadStageCatalog } from '../hooks/useLeadStages'
import { useBulkAssignTag, useBulkMoveStage, useKanbanSnapshot, useMoveLeadStage } from '../kanban-queries'
import type { LeadStage } from '../types'
import { LostReasonDialog } from './LostReasonDialog'
import { BulkActionsBar } from './kanban/BulkActionsBar'
import { StageLeadList } from './kanban/StageLeadList'
import { StageSidebar } from './kanban/StageSidebar'

// Puras y sin estado: viven en ámbito de módulo para no reconstruirse en
// cada render, lo que además rompía la memoización de los hijos.
function describeBulkFailure(action: string, failed: string[]) {
  if (failed.length === 0) return null
  return `${failed.length} lead${failed.length === 1 ? '' : 's'} no se pud${failed.length === 1 ? 'o' : 'ieron'} ${action}.`
}

interface KanbanBoardProps {
  onOpenChat: (chat: Chat) => void
}

export function KanbanBoard({ onOpenChat }: KanbanBoardProps) {
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [draggedChat, setDraggedChat] = useState<Chat | null>(null)
  const [movingIds, setMovingIds] = useState<Set<string>>(new Set())
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkError, setBulkError] = useState<string | null>(null)
  // Movimiento a una etapa de tipo `lost` esperando que el asesor escriba (o
  // saltee) la razón.
  const [pendingLost, setPendingLost] = useState<
    { kind: 'single'; chat: Chat; stage: LeadStage } | { kind: 'bulk'; count: number; stage: LeadStage } | null
  >(null)
  const [params, setParams] = useSearchParams()
  const catalog = useLeadStageCatalog()
  const { data: snapshot, isLoading: snapshotLoading, isError: snapshotError, refetch } = useKanbanSnapshot(debouncedSearch)
  const { data: tags = [] } = useTags()
  const { mutate: moveLead } = useMoveLeadStage()
  const { mutate: bulkMoveStage, isPending: isBulkMoving } = useBulkMoveStage()
  const { mutate: bulkAssignTag, isPending: isBulkTagging } = useBulkAssignTag()

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(timeout)
  }, [search])

  function handleMove(chat: Chat, stage: LeadStage, razonPerdido?: string | null) {
    if (chat.stage === stage || movingIds.has(chat.chat_id)) return
    // Antes de dar un lead por perdido se pide la razón (una sola vez: la
    // segunda pasada llega desde el diálogo con razonPerdido ya definido).
    if (catalog.isLost(stage) && razonPerdido === undefined) {
      setDraggedChat(null)
      setPendingLost({ kind: 'single', chat, stage })
      return
    }
    setMovingIds((current) => new Set(current).add(chat.chat_id))
    setDraggedChat(null)
    moveLead(
      { chatId: chat.chat_id, stage, razonPerdido },
      {
        // Un arrastre que cae en la columna equivocada se corrige con un click,
        // sin volver a buscar la tarjeta. Si venía de "perdido" se le devuelve
        // la razón que tenía, para no pedirla otra vez.
        onSuccess: () => toast.success(`Movido a ${catalog.label(stage)}`, {
          description: displayName(chat),
          action: {
            label: 'Deshacer',
            onClick: () => moveLead(
              { chatId: chat.chat_id, stage: chat.stage, razonPerdido: catalog.isLost(chat.stage) ? chat.razon_perdido : undefined },
              { onError: (error) => toast.error(`No se pudo deshacer. ${extractErrorMessage(error)}`) },
            ),
          },
        }),
        onError: (error) => toast.error(`No se pudo cambiar la etapa. ${extractErrorMessage(error)}`),
        onSettled: () => {
          setMovingIds((current) => {
            const next = new Set(current)
            next.delete(chat.chat_id)
            return next
          })
        },
      }
    )
  }

  function toggleSelect(chatId: string) {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(chatId)) next.delete(chatId)
      else next.add(chatId)
      return next
    })
  }

  function selectMany(chatIds: string[], selected: boolean) {
    setSelectedIds((current) => {
      const next = new Set(current)
      for (const chatId of chatIds) {
        if (selected) next.add(chatId)
        else next.delete(chatId)
      }
      return next
    })
  }

  function selectStage(stage: LeadStage) {
    // La selección es de lo que se ve: al cambiar de etapa se descarta para no
    // mover en bloque leads que ya no están en pantalla.
    setSelectedIds(new Set())
    setBulkError(null)
    setParams((current) => {
      const next = new URLSearchParams(current)
      next.set('etapa', stage)
      return next
    }, { replace: true })
  }

  function handleBulkMove(stage: LeadStage, razonPerdido?: string | null) {
    if (catalog.isLost(stage) && razonPerdido === undefined) {
      setPendingLost({ kind: 'bulk', count: selectedIds.size, stage })
      return
    }
    setBulkError(null)
    bulkMoveStage(
      { chatIds: Array.from(selectedIds), stage, razonPerdido },
      {
        onSuccess: (result) => {
          setBulkError(describeBulkFailure('mover', result.failed))
          setSelectedIds(new Set(result.failed))
        },
        onError: () => setBulkError('No se pudo mover la selección.'),
      }
    )
  }

  function handleBulkTag(tagId: number) {
    setBulkError(null)
    bulkAssignTag(
      { chatIds: Array.from(selectedIds), tagId },
      {
        onSuccess: (result) => {
          setBulkError(describeBulkFailure('etiquetar', result.failed))
          setSelectedIds(new Set(result.failed))
        },
        onError: () => setBulkError('No se pudo etiquetar la selección.'),
      }
    )
  }

  const isBulkBusy = isBulkMoving || isBulkTagging
  const totalLeads = snapshot ? Object.values(snapshot.counts).reduce((count, total) => count + total, 0) : 0
  const columns = kanbanColumns(catalog, snapshot?.counts ?? {})
  // La etapa elegida vive en la URL: al abrir un chat y volver, la vendedora
  // sigue en la misma etapa en vez de caer otra vez en la primera.
  const requestedStage = params.get('etapa')
  const selectedStage =
    columns.find((stage) => stage.key === requestedStage)
    ?? columns.find((stage) => (snapshot?.counts[stage.key] ?? 0) > 0)
    ?? columns[0]
  const boardDescription = snapshotLoading || snapshotError
    ? 'Consulta el avance de tus leads por etapa.'
    : totalLeads === 0
      ? debouncedSearch ? 'No hay leads que coincidan con tu búsqueda.' : 'Aquí verás tus leads organizados por etapa.'
      : `${totalLeads} ${totalLeads === 1 ? 'lead' : 'leads'} ${debouncedSearch ? 'en esta búsqueda' : 'en el embudo'}. Elige una etapa para ver sus leads; para moverlos, arrástralos sobre otra etapa o usa su selector.`

  return (
    <main className="flex min-h-0 min-w-0 w-full max-w-full flex-1 flex-col overflow-hidden bg-wa-app dark:bg-wa-app-dark">
      <div className="flex w-full min-w-0 shrink-0 flex-wrap items-end gap-3 border-b border-wa-border bg-wa-panel px-4 py-4 sm:px-6 dark:border-wa-border-dark dark:bg-wa-panel-dark">
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-semibold text-wa-text dark:text-wa-text-dark">Embudo comercial</h1>
          <p className="mt-1 text-sm leading-5 text-wa-muted dark:text-wa-muted-dark">{boardDescription}</p>
        </div>
        <div className="w-full sm:w-72">
          <label htmlFor="kanban-search" className="mb-1.5 block text-sm font-medium text-wa-text dark:text-wa-text-dark">Buscar leads</label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-wa-muted" aria-hidden="true" />
            <Input
              id="kanban-search"
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value)
                setSelectedIds(new Set())
                setBulkError(null)
              }}
              placeholder="Nombre, servicio o mensaje"
              className="h-11 border-wa-border pl-9 focus:ring-wa-primary-strong dark:border-wa-border-dark"
            />
          </div>
        </div>
      </div>

      {selectedIds.size > 0 && (
        <BulkActionsBar
          count={selectedIds.size}
          catalog={catalog}
          tags={tags}
          isBusy={isBulkBusy}
          error={bulkError}
          onMove={(stage) => handleBulkMove(stage)}
          onTag={handleBulkTag}
          onClear={() => {
            setSelectedIds(new Set())
            setBulkError(null)
          }}
        />
      )}

      {snapshotLoading ? (
        <div className="flex min-h-0 flex-1 items-center justify-center gap-2 text-sm text-wa-muted dark:text-wa-muted-dark" role="status">
          <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" aria-hidden="true" /> Cargando embudo…
        </div>
      ) : snapshotError ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-4">
          <div className="w-full max-w-md rounded-xl border border-red-500/30 bg-wa-panel p-6 text-center dark:bg-wa-panel-dark" role="alert">
            <AlertCircle className="mx-auto h-8 w-8 text-red-700 dark:text-red-300" aria-hidden="true" />
            <h2 className="mt-3 text-base font-semibold text-wa-text dark:text-wa-text-dark">No se pudo cargar el embudo</h2>
            <p className="mt-1 text-sm text-wa-muted dark:text-wa-muted-dark">Comprueba tu conexión y vuelve a intentarlo.</p>
            <Button variant="secondary" onClick={() => void refetch()} className="mt-4 h-10">Reintentar</Button>
          </div>
        </div>
      ) : totalLeads === 0 ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
          <div className="w-full max-w-md rounded-xl border border-wa-border bg-wa-panel px-6 py-10 text-center dark:border-wa-border-dark dark:bg-wa-panel-dark">
            <Inbox className="mx-auto h-9 w-9 text-wa-muted dark:text-wa-muted-dark" aria-hidden="true" />
            <h2 className="mt-3 text-lg font-semibold text-wa-text dark:text-wa-text-dark">{debouncedSearch ? 'No hay leads con esta búsqueda' : 'Aún no hay leads en el embudo'}</h2>
            <p className="mt-2 text-sm leading-6 text-wa-muted dark:text-wa-muted-dark">{debouncedSearch ? 'Prueba con otro nombre, servicio o mensaje.' : 'Los leads que registres desde Conversaciones aparecerán aquí para seguir su avance.'}</p>
            {debouncedSearch ? (
              <Button variant="secondary" onClick={() => { setSearch(''); setDebouncedSearch(''); setSelectedIds(new Set()); setBulkError(null) }} className="mt-5 h-10">Limpiar búsqueda</Button>
            ) : (
              <Link to="/" className="mt-5 inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-wa-primary-strong px-4 text-sm font-semibold text-white hover:bg-wa-primary-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-wa-primary-strong">Ir a Conversaciones <ArrowRight className="h-4 w-4" aria-hidden="true" /></Link>
            )}
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          <StageSidebar
            stages={columns}
            counts={snapshot?.counts ?? {}}
            selected={selectedStage.key}
            draggedChat={draggedChat}
            onSelect={selectStage}
            onDropChat={handleMove}
          />
          <StageLeadList
            key={selectedStage.key}
            stage={selectedStage}
            catalog={catalog}
            search={debouncedSearch}
            total={snapshot?.counts[selectedStage.key] ?? 0}
            initialPage={snapshot?.stages[selectedStage.key]}
            movingIds={movingIds}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
            onSelectMany={selectMany}
            onOpen={onOpenChat}
            onDragStart={setDraggedChat}
            onDragEnd={() => setDraggedChat(null)}
            onMove={handleMove}
          />
        </div>
      )}

      {pendingLost && (
        <LostReasonDialog
          count={pendingLost.kind === 'bulk' ? pendingLost.count : 1}
          stageName={catalog.label(pendingLost.stage)}
          onCancel={() => setPendingLost(null)}
          onConfirm={(razon) => {
            const pending = pendingLost
            setPendingLost(null)
            if (pending.kind === 'single') handleMove(pending.chat, pending.stage, razon)
            else handleBulkMove(pending.stage, razon)
          }}
        />
      )}
    </main>
  )
}
