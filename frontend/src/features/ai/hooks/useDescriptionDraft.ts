/**
 * Borrador del campo "Cuándo enviarlo" de un archivo y su guardado.
 *
 * Se guarda al salir del campo (o con Ctrl/Cmd+Enter), con el resultado al
 * lado del campo y no en un toast: con treinta archivos, treinta botones
 * "Guardar" iguales y avisos lejos de lo que se editó cansaban más de lo que
 * ayudaban.
 */
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { MediaAsset } from '../../media/types'
import { useSetAiResourceDescription } from '../queries'

type SaveState = 'idle' | 'saving' | 'saved' | 'error'

/** La regla del backend: con descripción el asistente ve el archivo; sin ella, no existe para él. */
export const isDescribed = (asset: MediaAsset) => Boolean(asset.ai_description?.trim())

export function useDescriptionDraft(asset: MediaAsset) {
  const saved = asset.ai_description ?? ''
  const [draft, setDraft] = useState(saved)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const save = useSetAiResourceDescription()
  const dirty = draft.trim() !== saved.trim()

  // Si otro usuario toca la biblioteca y la lista se refresca, no se pisa un
  // borrador que se está escribiendo; solo se alinea el campo en reposo.
  useEffect(() => {
    if (document.activeElement !== textareaRef.current) setDraft(saved)
  }, [saved])

  useEffect(() => {
    if (saveState !== 'saved') return
    const timer = window.setTimeout(() => setSaveState('idle'), 2500)
    return () => window.clearTimeout(timer)
  }, [saveState])

  function commit() {
    if (!dirty || save.isPending) return
    const description = draft.trim()
    setDraft(description)
    setSaveState('saving')
    save.mutate({ id: asset.id, description }, {
      onSuccess: () => setSaveState('saved'),
      onError: () => setSaveState('error'),
    })
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      commit()
    }
  }

  function retry() {
    setSaveState('idle')
    commit()
  }

  return { draft, setDraft, dirty, saveState, error: save.error, textareaRef, commit, onKeyDown, retry }
}
