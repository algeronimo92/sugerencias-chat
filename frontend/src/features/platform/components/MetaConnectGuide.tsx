import { Loader2, Smartphone, Monitor } from 'lucide-react'
import { useId, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { cn } from '../../../shared/utils/cn'
import type { MetaSignupMode } from '../types'

interface Option {
  mode: MetaSignupMode
  title: string
  summary: string
  points: string[]
  icon: typeof Smartphone
}

// Lo que la clínica tiene que saber antes de abrir la ventana de Meta, como
// en ManyChat: los dos caminos y lo que cuesta cada uno. Los títulos dicen lo
// que pasa con el número, no "Cloud API" ni "WABA"; "Coexistencia" va entre
// paréntesis porque es el nombre que la clínica ve en la ventana de Meta y en
// la ayuda de otros CRM.
const OPTIONS: Option[] = [
  {
    mode: 'business_app',
    title: 'Seguir usando WhatsApp en tu celular (Coexistencia)',
    summary: 'Conecta el número que ya usas en la app WhatsApp Business. Lo que escribas desde el celular también aparece en el CRM.',
    points: [
      'En la ventana de Meta elige conectar tu app de WhatsApp Business.',
      'Las llamadas siguen entrando al celular: no se atienden desde el CRM.',
    ],
    icon: Smartphone,
  },
  {
    mode: 'cloud_api',
    title: 'Número solo para el CRM',
    summary: 'El número deja de funcionar en la app del celular y todo se atiende desde el CRM.',
    points: [
      'El número no puede estar activo en ninguna app de WhatsApp: si lo está, primero borra la cuenta en la app.',
      'Meta te manda un código por SMS o llamada para verificarlo.',
      'Permite atender llamadas de WhatsApp desde el CRM.',
    ],
    icon: Monitor,
  },
]

interface Props {
  onContinue: (mode: MetaSignupMode) => void
  onCancel: () => void
  disabled?: boolean
  pending?: boolean
}

/** Elige cómo conectar el número antes de abrir la ventana de Meta. */
export function MetaConnectGuide({ onContinue, onCancel, disabled = false, pending = false }: Props) {
  const [mode, setMode] = useState<MetaSignupMode>('business_app')
  const name = useId()
  return (
    <fieldset className="space-y-3">
      <legend className="text-sm font-medium text-wa-text dark:text-wa-text-dark">
        ¿Cómo quieres conectar tu WhatsApp?
      </legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {OPTIONS.map(option => {
          const Icon = option.icon
          const selected = option.mode === mode
          return (
            <label
              key={option.mode}
              className={cn(
                'flex cursor-pointer flex-col gap-2 rounded-xl border p-3 text-left',
                selected
                  ? 'border-wa-primary bg-wa-primary/5 dark:border-wa-primary'
                  : 'border-wa-border dark:border-wa-border-dark',
              )}
            >
              <span className="flex items-center gap-2 text-sm font-medium text-wa-text dark:text-wa-text-dark">
                <input
                  type="radio"
                  name={name}
                  value={option.mode}
                  checked={selected}
                  onChange={() => setMode(option.mode)}
                  className="accent-wa-primary"
                />
                <Icon className="h-4 w-4" aria-hidden="true" />
                {option.title}
              </span>
              <span className="text-xs text-wa-muted dark:text-wa-muted-dark">{option.summary}</span>
              <ul className="list-disc space-y-1 pl-4 text-[11px] text-wa-muted dark:text-wa-muted-dark">
                {option.points.map(point => <li key={point}>{point}</li>)}
              </ul>
            </label>
          )
        })}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>Cancelar</Button>
        <Button size="sm" onClick={() => onContinue(mode)} disabled={disabled || pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
          Continuar con Meta
        </Button>
      </div>
    </fieldset>
  )
}
