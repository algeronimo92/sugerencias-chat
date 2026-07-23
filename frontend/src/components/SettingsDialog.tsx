import { useEffect, useState } from 'react'
import { Check, Loader2, Trash2, X } from 'lucide-react'
import type { SettingItem } from '../types'
import { useSaveSettings, useSettings } from '../hooks/useSettings'
import { extractErrorMessage } from '../utils/errors'
import { UsersPanel } from './UsersPanel'
import { WhatsappPanel } from './WhatsappPanel'

interface Props {
  onClose: () => void
  initialTab?: Tab
}

type Tab = 'claves' | 'whatsapp' | 'usuarios'

const TAB_CLASS = (active: boolean) =>
  `px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
    active
      ? 'bg-wa-primary text-white'
      : 'text-wa-muted dark:text-wa-muted-dark hover:bg-wa-field dark:hover:bg-wa-head-dark'
  }`

function groupItems(items: SettingItem[]): { group: string; groupLabel: string; items: SettingItem[] }[] {
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

export function SettingsDialog({ onClose, initialTab = 'claves' }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const { data, isLoading, error } = useSettings(tab === 'claves')
  const { mutate: save, isPending: isSaving } = useSaveSettings()

  // Valores no-secretos precargados con lo ya guardado (URLs, nombres de
  // instancia, etc. no son sensibles y sirven de referencia al editar).
  // Los secretos siempre arrancan vacíos: el backend nunca los devuelve.
  const [draft, setDraft] = useState<Record<string, string>>({})
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedAt, setSavedAt] = useState<number | null>(null)

  useEffect(() => {
    if (!data) return
    setDraft((prev) => {
      const next = { ...prev }
      for (const item of data) {
        if (!item.secret && !(item.key in next)) {
          next[item.key] = item.value ?? ''
        }
      }
      return next
    })
  }, [data])

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  function setField(key: string, value: string) {
    setDraft((prev) => ({ ...prev, [key]: value }))
    setSavedAt(null)
  }

  function handleSave() {
    if (!data) return
    setSaveError(null)

    const values: Record<string, string> = {}
    for (const item of data) {
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
        setSavedAt(Date.now())
        // Los campos secretos que se acaban de guardar se limpian del draft
        // para no dejar la clave escrita en el input después de guardar.
        setDraft((prev) => {
          const next = { ...prev }
          for (const item of data) {
            if (item.secret) delete next[item.key]
          }
          return next
        })
      },
      onError: (err) => setSaveError(extractErrorMessage(err)),
    })
  }

  function handleClearSecret(key: string) {
    setSaveError(null)
    save(
      { [key]: '' },
      {
        onSuccess: () => setDraft((prev) => ({ ...prev, [key]: '' })),
        onError: (err) => setSaveError(extractErrorMessage(err)),
      }
    )
  }

  const groups = data ? groupItems(data) : []

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col bg-white dark:bg-wa-panel-dark rounded-xl shadow-xl border border-wa-border dark:border-wa-border-dark overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-wa-border dark:border-wa-border-dark shrink-0">
          <div className="flex items-center gap-3">
            <p className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Configuración</p>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setTab('claves')} className={TAB_CLASS(tab === 'claves')}>
                Claves
              </button>
              <button type="button" onClick={() => setTab('whatsapp')} className={TAB_CLASS(tab === 'whatsapp')}>
                WhatsApp
              </button>
              <button type="button" onClick={() => setTab('usuarios')} className={TAB_CLASS(tab === 'usuarios')}>
                Usuarios
              </button>
            </div>
          </div>
          <button
            onClick={onClose}
            aria-label="Cerrar"
            className="text-wa-muted hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {tab === 'usuarios' && <UsersPanel />}

          {tab === 'whatsapp' && <WhatsappPanel onGoToClaves={() => setTab('claves')} />}

          {tab === 'claves' && isLoading && (
            <p className="text-sm text-wa-muted dark:text-wa-muted-dark text-center py-8">Cargando configuración...</p>
          )}
          {tab === 'claves' && error && (
            <p className="text-sm text-red-500 dark:text-red-400 text-center py-8">
              Error al cargar la configuración.
            </p>
          )}

          {tab === 'claves' && groups.map((g) => (
            <div key={g.group}>
              <h3 className="text-xs font-semibold text-wa-muted dark:text-wa-muted-dark uppercase tracking-wide mb-2">
                {g.groupLabel}
              </h3>
              <div className="space-y-2.5">
                {g.items.map((item) => (
                  <div key={item.key}>
                    <label className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 mb-1">
                      {item.label}
                      {item.secret && (
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                            item.configured
                              ? 'bg-green-100 dark:bg-green-950/50 text-wa-primary-strong dark:text-wa-primary'
                              : 'bg-wa-field dark:bg-wa-head-dark text-wa-muted dark:text-wa-muted-dark'
                          }`}
                        >
                          {item.configured ? 'Configurada' : 'No configurada'}
                        </span>
                      )}
                    </label>
                    <div className="flex items-center gap-1.5">
                      <input
                        type={item.secret ? 'password' : 'text'}
                        value={draft[item.key] ?? ''}
                        onChange={(e) => setField(item.key, e.target.value)}
                        placeholder={item.secret ? (item.configured ? '•••• sin cambios' : 'Sin configurar') : ''}
                        autoComplete="off"
                        className="flex-1 text-sm bg-wa-hover dark:bg-wa-head-dark text-wa-text dark:text-wa-text-dark border border-wa-border dark:border-wa-border-dark rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-wa-primary/60 focus:border-transparent placeholder:text-wa-muted dark:placeholder:text-wa-muted-dark"
                      />
                      {item.secret && item.configured && (
                        <button
                          type="button"
                          onClick={() => handleClearSecret(item.key)}
                          disabled={isSaving}
                          aria-label={`Borrar ${item.label}`}
                          title="Borrar valor guardado"
                          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-wa-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:opacity-50 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {tab === 'claves' && (
          <div className="border-t border-wa-border dark:border-wa-border-dark px-4 py-3 flex items-center gap-3 shrink-0">
            {saveError && <p className="text-xs text-red-500 dark:text-red-400 flex-1">{saveError}</p>}
            {!saveError && savedAt && (
              <p className="text-xs text-wa-primary-strong dark:text-wa-primary flex items-center gap-1 flex-1">
                <Check className="w-3.5 h-3.5" /> Guardado
              </p>
            )}
            {!saveError && !savedAt && <span className="flex-1" />}
            <button
              onClick={handleSave}
              disabled={isSaving || isLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-wa-primary hover:bg-wa-primary-strong disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1.5"
            >
              {isSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Guardar
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
