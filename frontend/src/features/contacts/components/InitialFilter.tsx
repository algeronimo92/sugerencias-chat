import { useRef, useState, type KeyboardEvent } from 'react'
import { cn } from '../../../shared/utils/cn'
import { INITIALS } from '../domain/filters'

interface Props {
  /** Vacío = todas. */
  value: string
  onChange: (initial: string) => void
}

const OPTIONS = ['', ...INITIALS]

function optionLabel(initial: string) {
  if (initial === '') return 'Todos'
  return initial
}

function accessibleLabel(initial: string) {
  if (initial === '') return 'Todos los contactos'
  if (initial === '#') return '#, nombres que no empiezan con letra'
  return `Nombres con ${initial}`
}

/**
 * Filtro A-Z de la agenda. Es una barra de herramientas con un solo punto de
 * tabulación: 29 botones seguidos obligaban a pasar por todos con Tab para
 * llegar a la lista. Las flechas recorren las letras e Intro o Espacio eligen;
 * elegir no se dispara al mover el foco, para no pedir una página por tecla.
 * En el celular la fila se desliza de costado. Se centra solo desde tablet:
 * con justify-center en una fila que desborda, el inicio ("Todos", A, B…)
 * queda cortado a la izquierda y no se alcanza con el scroll.
 */
export function InitialFilter({ value, onChange }: Props) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([])
  // Foco móvil: un solo botón con tabIndex 0, el último que tuvo el foco.
  const [focusIndex, setFocusIndex] = useState(() => Math.max(0, OPTIONS.indexOf(value)))

  function moveFocus(event: KeyboardEvent<HTMLDivElement>) {
    const current = buttons.current.findIndex(button => button === document.activeElement)
    if (current < 0) return
    const last = OPTIONS.length - 1
    const next = {
      ArrowRight: Math.min(last, current + 1),
      ArrowLeft: Math.max(0, current - 1),
      Home: 0,
      End: last,
    }[event.key]
    if (next === undefined) return
    event.preventDefault()
    setFocusIndex(next)
    buttons.current[next]?.focus()
  }

  return (
    <div
      role="toolbar"
      aria-label="Filtrar por inicial del nombre"
      onKeyDown={moveFocus}
      className="-mx-4 mt-3 flex gap-1 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:justify-center sm:overflow-visible sm:px-0"
    >
      {OPTIONS.map((initial, index) => {
        const active = initial === value
        return (
          <button
            key={initial || 'todos'}
            ref={element => { buttons.current[index] = element }}
            type="button"
            aria-pressed={active}
            aria-label={accessibleLabel(initial)}
            tabIndex={index === focusIndex ? 0 : -1}
            onFocus={() => setFocusIndex(index)}
            onClick={() => onChange(initial)}
            className={cn(
              // 40 px en el celular (se toca con el pulgar), 32 desde tablet,
              // donde la fila entera cabe y se apunta con el cursor.
              'inline-flex h-10 min-w-10 shrink-0 items-center justify-center rounded-lg px-2 text-sm tabular-nums outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring sm:h-8 sm:min-w-8',
              active ? 'bg-selected font-semibold text-fg' : 'font-medium text-fg-muted hover:bg-subtle hover:text-fg',
              initial === '' && 'px-3',
            )}
          >
            {optionLabel(initial)}
          </button>
        )
      })}
    </div>
  )
}
