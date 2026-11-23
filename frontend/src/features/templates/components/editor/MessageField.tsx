import type { EmojiClickData, EmojiStyle, Theme } from 'emoji-picker-react'
import { Bold, Italic, Smile } from 'lucide-react'
import { lazy, Suspense, useRef, useState, type ReactNode, type RefObject } from 'react'
import { useDismissiblePopover } from '../../../../shared/hooks/useDismissiblePopover'
import { Textarea } from '../../../../shared/ui/Input'
import { wrapSelection } from '../../domain/officialVariables'
import { insertAtCursor } from '../../domain/variableInsertion'
import { CharCounter, FieldErrors, FieldLabel } from './parts'

const EmojiPicker = lazy(() => import('emoji-picker-react'))

const toolClass = 'inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line-control bg-surface text-fg outline-none transition-colors hover:bg-subtle focus-visible:ring-2 focus-visible:ring-ring'

interface Props {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  /** El tope del texto para este tipo de plantilla. */
  max: number | undefined
  placeholder?: string
  errors: string[]
  /** Lo que inserta datos en el texto (fichas o menú); recibe el campo para
   *  insertar donde está el cursor. */
  insertTools: (field: RefObject<HTMLTextAreaElement | null>) => ReactNode
  hint?: ReactNode
}

/**
 * El texto del mensaje con sus herramientas debajo: insertar un dato,
 * negrita, cursiva y emoji (2026-11-23). Las plantillas del negocio usan
 * `*negrita*` y emojis en casi todos los mensajes, y había que escribir las
 * marcas de memoria. El contador y el tope van siempre a la vista.
 */
export function MessageField({ id, label, value, onChange, max, placeholder, errors, insertTools, hint }: Props) {
  const field = useRef<HTMLTextAreaElement>(null)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const emojiPanel = useDismissiblePopover<HTMLDivElement>(emojiOpen, () => setEmojiOpen(false))
  const errorId = `${id}-error`
  const counterId = `${id}-count`

  function restore(start: number, end: number) {
    requestAnimationFrame(() => {
      field.current?.focus()
      field.current?.setSelectionRange(start, end)
    })
  }

  function wrap(mark: string) {
    const next = wrapSelection(field.current, value, mark)
    if (max !== undefined && next.value.length > max) return
    onChange(next.value)
    restore(next.selectionStart, next.selectionEnd)
  }

  function insertEmoji(emoji: string) {
    const next = insertAtCursor(field.current, value, emoji)
    if (max !== undefined && next.value.length > max) return
    onChange(next.value)
    restore(next.caret, next.caret)
  }

  const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark')

  return (
    <div className="flex flex-col gap-2">
      <div className="-mb-2 flex items-baseline justify-between gap-3">
        <FieldLabel htmlFor={id} required>{label}</FieldLabel>
        <CharCounter id={counterId} length={value.length} max={max} />
      </div>
      <Textarea
        id={id}
        ref={field}
        rows={6}
        value={value}
        maxLength={max}
        placeholder={placeholder}
        aria-invalid={errors.length > 0 || undefined}
        aria-describedby={[max !== undefined ? counterId : null, errors.length > 0 ? errorId : null].filter(Boolean).join(' ') || undefined}
        onChange={event => onChange(event.target.value)}
        className="min-h-32 resize-y leading-relaxed"
      />
      <div className="flex flex-wrap items-center gap-1.5">
        {insertTools(field)}
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-line" />
        <button type="button" aria-label="Negrita" title="Negrita: *texto*" onClick={() => wrap('*')} className={toolClass}><Bold className="h-4 w-4" aria-hidden="true" /></button>
        <button type="button" aria-label="Cursiva" title="Cursiva: _texto_" onClick={() => wrap('_')} className={toolClass}><Italic className="h-4 w-4" aria-hidden="true" /></button>
        <div ref={emojiPanel} className="relative">
          <button type="button" aria-label="Insertar emoji" aria-expanded={emojiOpen} onClick={() => setEmojiOpen(open => !open)} className={toolClass}><Smile className="h-4 w-4" aria-hidden="true" /></button>
          {emojiOpen && (
            <div className="wa-emoji absolute left-0 top-full z-30 mt-2 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-line bg-surface-raised shadow-popover">
              <Suspense fallback={<div className="h-[340px] w-[320px] max-w-full" />}>
                <EmojiPicker
                  onEmojiClick={(data: EmojiClickData) => insertEmoji(data.emoji)}
                  emojiStyle={'native' as EmojiStyle}
                  theme={(isDark ? 'dark' : 'light') as Theme}
                  lazyLoadEmojis
                  width={320}
                  height={340}
                  previewConfig={{ showPreview: false }}
                  searchPlaceHolder="Buscar emoji"
                />
              </Suspense>
            </div>
          )}
        </div>
      </div>
      {hint}
      <FieldErrors id={errorId} messages={errors} />
    </div>
  )
}
