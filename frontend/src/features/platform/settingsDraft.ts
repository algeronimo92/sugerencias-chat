import { useMemo, useState } from 'react'
import { extractErrorMessage } from '../../shared/utils/errors'
import { useSaveSettings } from './hooks/useSettings'
import type { SettingItem } from './types'

/**
 * Borrador y guardado de un conjunto de ajustes. Lo comparten el diálogo de
 * Configuración (ajustes del CRM) y las tarjetas de Integraciones (cada
 * integración guarda lo suyo), así los secretos se tratan igual en todos
 * lados: nunca vuelven del servidor, solo se sobrescriben o se borran.
 */
export function useSettingsDraft(items: SettingItem[] | undefined) {
  const { mutate: save, isPending: isSaving } = useSaveSettings()
  // Solo lo que el usuario tocó y todavía no guardó; el resto se lee del
  // servidor en cada render. El Embedded Signup de WhatsApp guarda el waba id
  // y el phone number id por su cuenta: copiarlos a un estado propio los
  // dejaba vacíos acá (y un "Guardar" posterior los borraba).
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [clearingSecretKey, setClearingSecretKey] = useState<string | null>(null)

  // Los secretos nunca vuelven del servidor: solo existen si se tipearon.
  const draft = useMemo(() => {
    const fromServer: Record<string, string> = {}
    for (const item of items ?? []) if (!item.secret) fromServer[item.key] = item.value || ''
    return { ...fromServer, ...edits }
  }, [items, edits])

  function setField(key: string, value: string) {
    setEdits((prev) => ({ ...prev, [key]: value }))
    setSavedAt(null)
  }

  const isDirty = Object.keys(edits).length > 0

  function handleSave(onSuccess?: () => void) {
    if (!items) return
    setSaveError(null)
    const values: Record<string, string> = {}
    for (const item of items) {
      const typed = draft[item.key]
      if (item.secret) {
        // Un secreto solo se sobrescribe si el usuario tipeó algo nuevo;
        // dejarlo vacío significa "no tocar", no "borrar" (eso es el botón
        // de basurero, que manda el pedido al toque).
        if (typed) values[item.key] = typed
      } else {
        values[item.key] = typed ?? ''
      }
    }
    save(values, {
      onSuccess: () => {
        // La respuesta ya actualizó la caché: lo guardado se ve desde el servidor.
        setEdits({})
        setSavedAt(Date.now())
        onSuccess?.()
      },
      onError: (err) => setSaveError(extractErrorMessage(err)),
    })
  }

  function clearSecret(key: string) {
    setSaveError(null)
    setClearingSecretKey(key)
    save(
      { [key]: '' },
      {
        onSuccess: () => setEdits((prev) => {
          const next = { ...prev }
          delete next[key]
          return next
        }),
        onError: (err) => setSaveError(extractErrorMessage(err)),
        onSettled: () => setClearingSecretKey(null),
      },
    )
  }

  return { draft, setField, isDirty, handleSave, isSaving, saveError, savedAt, clearSecret, clearingSecretKey }
}

export type SettingsDraft = ReturnType<typeof useSettingsDraft>


export function groupSettings(items: SettingItem[]): { group: string; groupLabel: string; items: SettingItem[] }[] {
  const groups: { group: string; groupLabel: string; items: SettingItem[] }[] = []
  for (const item of items) {
    let g = groups.find((g) => g.group === item.group)
    if (!g) {
      g = { group: item.group, groupLabel: item.group_label, items: [] }
      groups.push(g)
    }
    g.items.push(item)
  }
  return groups
}
