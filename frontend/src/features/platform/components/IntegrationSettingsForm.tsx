import { Check, Loader2 } from 'lucide-react'
import { Button } from '../../../shared/ui/Button'
import type { SettingItem } from '../types'
import { useSettingsDraft } from '../settingsDraft'
import { SettingField } from './SettingField'

/**
 * Los campos de una integración con su propio "Guardar": cada tarjeta guarda
 * lo suyo y no pisa lo de las demás (el diálogo de Configuración guardaba
 * todos los grupos de una vez).
 */
export function IntegrationSettingsForm({ items, saveLabel = 'Guardar' }: { items: SettingItem[]; saveLabel?: string }) {
  const form = useSettingsDraft(items)
  return (
    <div className="space-y-3">
      <div className="space-y-2.5">
        {items.map(item => <SettingField key={item.key} item={item} form={form} />)}
      </div>
      <div className="flex items-center gap-3">
        {form.saveError && <p role="alert" className="flex-1 text-xs text-red-600 dark:text-red-400">{form.saveError}</p>}
        {!form.saveError && form.savedAt && (
          <p role="status" className="flex flex-1 items-center gap-1 text-xs text-wa-primary-strong dark:text-wa-primary">
            <Check className="h-3.5 w-3.5" aria-hidden="true" /> Guardado
          </p>
        )}
        {!form.saveError && !form.savedAt && <span className="flex-1" />}
        <Button size="sm" className="h-9" onClick={() => form.handleSave()} disabled={form.isSaving || !form.isDirty}>
          {form.isSaving && form.clearingSecretKey === null && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />}
          {saveLabel}
        </Button>
      </div>
    </div>
  )
}
