import { Check, Loader2, Plug, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from '../../../shared/ui/Dialog'
import { useSettings } from '../hooks/useSettings'
import { groupSettings, useSettingsDraft } from '../settingsDraft'
import { SettingField } from './SettingField'
import { UsersPanel } from './UsersPanel'

interface Props {
  onClose: () => void
  initialTab?: Tab
  /** Lleva a la página de Integraciones (y cierra el diálogo). */
  onOpenIntegrations?: () => void
}

type Tab = 'general' | 'usuarios'

// Las conexiones con terceros viven en la página de Integraciones, cada una
// con su propio "Guardar": acá no se muestran ni se reenvían, donde un
// "Guardar" con el borrador viejo pisaría lo que la otra pantalla acaba de
// conectar (el calendario elegido, las claves que dejó el Embedded Signup).
const INTEGRATION_GROUPS = new Set(['calendar', 'meta', 'elevenlabs', 'erp', 'whatsapp', 'ai'])

const TAB_CLASS = (active: boolean) =>
  `px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
    active
      ? 'bg-wa-primary text-white'
      : 'text-wa-muted dark:text-wa-muted-dark hover:bg-wa-field dark:hover:bg-wa-head-dark'
  }`

export function SettingsDialog({ onClose, initialTab = 'general', onOpenIntegrations }: Props) {
  const [tab, setTab] = useState<Tab>(initialTab)
  const { data: allSettings, isLoading, error } = useSettings(tab === 'general')
  const data = useMemo(() => allSettings?.filter((item) => !INTEGRATION_GROUPS.has(item.group)), [allSettings])
  const form = useSettingsDraft(data)
  const { handleSave, isSaving, saveError, savedAt, clearingSecretKey } = form
  const groups = data ? groupSettings(data) : []

  return (
    <Dialog.Root open onOpenChange={open => { if (!open) onClose() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content className={`${dialogContentPositionClass} flex max-h-[85vh] w-[calc(100%-2rem)] max-w-lg flex-col overflow-hidden rounded-xl border border-wa-border bg-white shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}>
        <div className="border-b border-wa-border dark:border-wa-border-dark shrink-0">
          <div className="flex items-center justify-between px-4 py-3">
            <Dialog.Title className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">Configuración</Dialog.Title>
            <button type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="text-wa-muted hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="flex items-center gap-1 overflow-x-auto px-4 pb-3">
            <button type="button" onClick={() => setTab('general')} className={`${TAB_CLASS(tab === 'general')} shrink-0`}>
              General
            </button>
            <button type="button" onClick={() => setTab('usuarios')} className={`${TAB_CLASS(tab === 'usuarios')} shrink-0`}>
              Usuarios
            </button>
          </div>
          {onOpenIntegrations && (
            <p className="flex items-center gap-1.5 border-t border-wa-border/70 px-4 py-2 text-xs text-wa-muted dark:border-wa-border-dark/70 dark:text-wa-muted-dark">
              <Plug className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
              <span>
                WhatsApp, Google Calendar, ERP, voz y correo ahora están en{' '}
                <button type="button" onClick={onOpenIntegrations} className="font-semibold text-wa-primary-strong underline dark:text-wa-primary">
                  Integraciones
                </button>
                .
              </span>
            </p>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-5">
          {tab === 'usuarios' && <UsersPanel />}

          {tab === 'general' && isLoading && (
            <p className="text-sm text-wa-muted dark:text-wa-muted-dark text-center py-8">Cargando configuración...</p>
          )}
          {tab === 'general' && error && (
            <p className="text-sm text-red-500 dark:text-red-400 text-center py-8">
              Error al cargar la configuración.
            </p>
          )}

          {tab === 'general' && groups.map((g) => (
            <div key={g.group}>
              <h3 className="text-xs font-semibold text-wa-muted dark:text-wa-muted-dark uppercase tracking-wide mb-2">
                {g.groupLabel}
              </h3>
              <div className="space-y-2.5">
                {g.items.map((item) => <SettingField key={item.key} item={item} form={form} />)}
              </div>
            </div>
          ))}
        </div>

        {tab === 'general' && (
          <div className="border-t border-wa-border dark:border-wa-border-dark px-4 py-3 flex items-center gap-3 shrink-0">
            {saveError && <p className="text-xs text-red-500 dark:text-red-400 flex-1">{saveError}</p>}
            {!saveError && savedAt && (
              <p className="text-xs text-wa-primary-strong dark:text-wa-primary flex items-center gap-1 flex-1">
                <Check className="w-3.5 h-3.5" /> Guardado
              </p>
            )}
            {!saveError && !savedAt && <span className="flex-1" />}
            <button type="button"
              onClick={() => handleSave()}
              disabled={isSaving || isLoading}
              className="px-4 py-2 text-sm font-medium text-white bg-wa-primary hover:bg-wa-primary-strong disabled:opacity-50 rounded-lg transition-colors flex items-center gap-1.5"
            >
              {isSaving && clearingSecretKey === null && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Guardar
            </button>
          </div>
        )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
