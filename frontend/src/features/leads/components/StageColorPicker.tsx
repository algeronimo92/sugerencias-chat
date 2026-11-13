import { useEffect, useRef, useState } from 'react'
import { Input } from '../../../shared/ui/Input'

interface Props {
  value: string
  onChange: (color: string) => void
  label: string
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i
const COMMIT_DELAY_MS = 120
const colorInputClass =
  'shrink-0 cursor-pointer rounded-lg border-0 bg-transparent p-0 [&::-moz-color-swatch]:rounded-lg [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-lg [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:rounded-lg [&::-webkit-color-swatch-wrapper]:p-0'

function normalizedHex(value: string): string | null {
  const candidate = value.trim().startsWith('#') ? value.trim() : `#${value.trim()}`
  return HEX_COLOR.test(candidate) ? candidate.toLowerCase() : null
}

/** El input de color abre el selector completo del navegador/sistema (rueda,
 * brillo y cuentagotas cuando están disponibles). El texto permite pegar o
 * escribir un color exacto sin impedir valores parciales mientras se edita. */
export function StageColorPicker({ value, onChange, label }: Props) {
  const [preview, setPreview] = useState(value)
  const [hex, setHex] = useState(value.toUpperCase())
  const pending = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    setPreview(value)
    setHex(value.toUpperCase())
  }, [value])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  function commitLater(color: string) {
    pending.current = color
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      timer.current = null
      pending.current = null
      onChange(color)
    }, COMMIT_DELAY_MS)
  }

  function cancelPending() {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    pending.current = null
  }

  function flush() {
    const color = pending.current
    if (!color) return
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    pending.current = null
    onChange(color)
  }

  function selectColor(color: string) {
    setPreview(color)
    setHex(color.toUpperCase())
    commitLater(color)
  }

  function handleHexChange(next: string) {
    setHex(next.toUpperCase())
    const normalized = normalizedHex(next)
    if (normalized) {
      setPreview(normalized)
      commitLater(normalized)
    } else cancelPending()
  }

  return (
    <div className="flex w-full max-w-xs items-center gap-2">
      <input
        type="color"
        value={preview}
        onChange={event => selectColor(event.target.value.toLowerCase())}
        onBlur={flush}
        aria-label={label}
        title="Abrir selector de color"
        className={`h-10 w-12 ${colorInputClass}`}
      />
      <Input
        value={hex}
        onChange={event => handleHexChange(event.target.value)}
        onBlur={() => {
          const normalized = normalizedHex(hex)
          if (normalized) {
            setHex(normalized.toUpperCase())
            setPreview(normalized)
            flush()
          } else {
            cancelPending()
            setHex(value.toUpperCase())
            setPreview(value)
          }
        }}
        aria-label={`${label} hexadecimal`}
        inputMode="text"
        spellCheck={false}
        maxLength={7}
        placeholder="#0EA5E9"
        className="h-10 bg-white font-mono uppercase dark:bg-wa-head-dark"
      />
    </div>
  )
}
