import { Loader2, Trash2 } from 'lucide-react'
import { Checkbox } from '../../../shared/ui/Checkbox'
import type { SettingItem } from '../types'
import type { SettingsDraft } from '../settingsDraft'
import { AutoAssignSellers } from './AutoAssignSellers'

// La exclusión del reparto se guarda como ids, pero se edita como una lista
// de vendedores y solo tiene sentido con el reparto encendido.
const AUTO_ASSIGN_KEY = 'auto_assign_leads_enabled'
const AUTO_ASSIGN_EXCLUDED_KEY = 'auto_assign_excluded_user_ids'

export const settingInputClass =
  'flex-1 text-sm bg-wa-hover dark:bg-wa-head-dark text-wa-text dark:text-wa-text-dark border border-wa-border dark:border-wa-border-dark rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-wa-primary/60 focus:border-transparent placeholder:text-wa-muted dark:placeholder:text-wa-muted-dark'

/** Un ajuste: texto, secreto (con chip de estado y borrado) o casilla. */
export function SettingField({ item, form }: { item: SettingItem; form: SettingsDraft }) {
  const { draft, setField, clearSecret, clearingSecretKey, isSaving } = form
  if (item.key === AUTO_ASSIGN_EXCLUDED_KEY) {
    return (draft[AUTO_ASSIGN_KEY] ?? '') === 'true'
      ? <AutoAssignSellers value={draft[item.key] ?? ''} onChange={(value) => setField(item.key, value)} />
      : null
  }
  if (item.boolean) {
    return (
      <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
        <Checkbox checked={(draft[item.key] ?? '') === 'true'} onCheckedChange={(checked) => setField(item.key, checked ? 'true' : 'false')} />
        {item.label}
      </label>
    )
  }
  const inputId = `setting-${item.key}`
  return (
    <div>
      <label htmlFor={inputId} className="flex items-center gap-1.5 text-xs text-gray-600 dark:text-gray-300 mb-1">
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
          id={inputId}
          type={item.secret ? 'password' : 'text'}
          value={draft[item.key] ?? ''}
          onChange={(e) => setField(item.key, e.target.value)}
          placeholder={item.secret ? (item.configured ? '•••• sin cambios' : 'Sin configurar') : ''}
          autoComplete="off"
          className={settingInputClass}
        />
        {item.secret && item.configured && (
          <button
            type="button"
            onClick={() => clearSecret(item.key)}
            disabled={isSaving}
            aria-label={clearingSecretKey === item.key ? `Borrando ${item.label}` : `Borrar ${item.label}`}
            aria-busy={clearingSecretKey === item.key}
            title={clearingSecretKey === item.key ? 'Borrando valor…' : 'Borrar valor guardado'}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg text-wa-muted hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-950/30 disabled:cursor-wait disabled:opacity-60 transition-colors"
          >
            {clearingSecretKey === item.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  )
}

