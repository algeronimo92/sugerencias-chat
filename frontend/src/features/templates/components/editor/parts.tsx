import { AlertCircle, Info, TriangleAlert } from 'lucide-react'
import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react'
import { fieldClass } from '../../../../shared/ui/Input'
import { cn } from '../../../../shared/utils/cn'
import { counterTone } from '../../domain/fieldLimits'

/** Una tarjeta del editor: título, una línea de ayuda y su contenido. */
export function EditorSection({ title, description, children }: { title: string; description?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-sm text-fg-muted">{description}</p>}
      </div>
      {children}
    </section>
  )
}

interface ChoiceProps {
  name: string
  checked: boolean
  onSelect: () => void
  title: string
  description?: string
  disabled?: boolean
}

/** Una opción excluyente con explicación: un radio de verdad dentro de una
 *  tarjeta, así el teclado y el lector de pantalla saben cuál está elegida
 *  (antes eran dos botones que solo cambiaban de color). */
export function ChoiceCard({ name, checked, onSelect, title, description, disabled }: ChoiceProps) {
  return (
    <label className={cn(
      'flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors',
      checked ? 'border-accent-strong bg-accent-soft ring-1 ring-accent-strong' : 'border-line-control hover:bg-subtle',
      // `has-[:disabled]`: también cuando lo deshabilita un <fieldset> que lo envuelve.
      'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
    )}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} disabled={disabled} className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--accent-fill)]" />
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-fg">{title}</span>
        {description && <span className={cn('mt-0.5 block text-sm', checked ? 'text-accent-deep' : 'text-fg-muted')}>{description}</span>}
      </span>
    </label>
  )
}

/** La misma opción excluyente en una sola línea, para elegir entre formatos. */
export function ChoicePill({ name, checked, onSelect, title, disabled }: Omit<ChoiceProps, 'description'>) {
  return (
    <label className={cn(
      'inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition-colors',
      checked ? 'border-accent-strong bg-accent-soft font-semibold text-fg ring-1 ring-accent-strong' : 'border-line-control text-fg hover:bg-subtle',
      // `has-[:disabled]`: también cuando lo deshabilita un <fieldset> que lo envuelve.
      'has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60',
    )}>
      <input type="radio" name={name} checked={checked} onChange={onSelect} disabled={disabled} className="h-4 w-4 shrink-0 accent-[var(--accent-fill)]" />
      {title}
    </label>
  )
}

/** Los problemas de un campo, junto a él. Se anuncian y llevan icono. */
export function FieldErrors({ id, messages }: { id?: string; messages: string[] }) {
  if (messages.length === 0) return null
  return (
    <ul id={id} role="alert" className="flex flex-col gap-1">
      {messages.map(message => (
        <li key={message} className="flex items-start gap-1.5 text-sm font-medium text-danger-fg">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          {message}
        </li>
      ))}
    </ul>
  )
}

const TONE_CLASS = {
  calm: 'text-fg-muted',
  near: 'text-warning-fg font-medium',
  full: 'text-danger-fg font-semibold',
  over: 'text-danger-fg font-semibold',
} as const

/**
 * Cuánto lleva escrito un campo frente a su tope. Cambia de color al
 * acercarse (90 %) y al llegar; el lector de pantalla solo lo anuncia ahí,
 * no en cada tecla.
 */
export function CharCounter({ id, length, max, className }: { id?: string; length: number; max: number | undefined; className?: string }) {
  if (max === undefined) return null
  const tone = counterTone(length, max)
  return (
    <span id={id} className={cn('shrink-0 text-xs tabular-nums', TONE_CLASS[tone], className)}>
      <span aria-hidden="true">{length} / {max}</span>
      <span className="sr-only" aria-live="polite">
        {tone === 'calm' ? `${length} de ${max} caracteres` : tone === 'over' ? `Te pasaste por ${length - max} caracteres del máximo de ${max}` : tone === 'full' ? `Llegaste al máximo de ${max} caracteres` : `Quedan ${max - length} caracteres`}
      </span>
    </span>
  )
}

interface CountedInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'maxLength'> {
  value: string
  /** El tope del campo: frena la escritura y alimenta el contador. */
  max: number | undefined
  /** Para topes muy holgados (una URL, 2000): el contador aparece recién
   *  cerca del tope, donde sirve, y no como ruido permanente. */
  quiet?: boolean
  ref?: Ref<HTMLInputElement>
}

/**
 * Un campo de una línea con su contador dentro, a la derecha. El tope frena
 * la escritura (`maxLength`), así que no hay forma de pasarse tecleando ni
 * pegando; el contador avisa antes de llegar.
 */
export function CountedInput({ value, max, quiet = false, className, ref, 'aria-describedby': describedBy, ...rest }: CountedInputProps) {
  const counterId = useId()
  const shown = max !== undefined && (!quiet || counterTone(value.length, max) !== 'calm')
  return (
    <div className="relative min-w-0 flex-1">
      <input
        ref={ref}
        value={value}
        maxLength={max}
        aria-describedby={[describedBy, shown ? counterId : undefined].filter(Boolean).join(' ') || undefined}
        className={cn(fieldClass, 'min-h-10', shown && 'pr-[4.5rem]', className)}
        {...rest}
      />
      {shown && <CharCounter id={counterId} length={value.length} max={max} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2" />}
    </div>
  )
}

/** Etiqueta de un campo con la marca de obligatorio u opcional escrita, no
 *  con un asterisco suelto (antes caía en una línea propia). */
export function FieldLabel({ htmlFor, children, optional, required }: { htmlFor?: string; children: ReactNode; optional?: boolean; required?: boolean }) {
  const Tag = htmlFor ? 'label' : 'span'
  return (
    <Tag htmlFor={htmlFor} className="mb-1.5 block text-sm font-medium text-fg">
      {children}
      {/* El espacio va fuera del span: adentro, el nombre accesible quedaba
          pegado («Nombre(obligatorio)»). */}
      {required && <>{' '}<span className="font-normal text-fg-muted">(obligatorio)</span></>}
      {optional && <>{' '}<span className="font-normal text-fg-muted">(opcional)</span></>}
    </Tag>
  )
}

const NOTICE = {
  info: { icon: Info, className: 'bg-info-soft text-info-fg' },
  accent: { icon: Info, className: 'bg-accent-soft text-accent-deep' },
  warning: { icon: TriangleAlert, className: 'bg-warning-soft text-warning-fg' },
  danger: { icon: AlertCircle, className: 'bg-danger-soft text-danger-fg' },
} as const

/** Un aviso del editor. El de error se anuncia como alerta; el resto, como estado. */
export function Notice({ tone, children, action }: { tone: keyof typeof NOTICE; children: ReactNode; action?: ReactNode }) {
  const { icon: Icon, className } = NOTICE[tone]
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={cn('flex flex-wrap items-start gap-x-3 gap-y-2 rounded-xl px-4 py-3 text-sm', className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-[1_1_14rem]">{children}</div>
      {action}
    </div>
  )
}
