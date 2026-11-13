import { useEffect, useState } from 'react'
import { Input } from '../../../shared/ui/Input'

interface Props {
  value: string
  onChange: (color: string) => void
  label: string
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i
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
  const [hex, setHex] = useState(value.toUpperCase())

  useEffect(() => setHex(value.toUpperCase()), [value])

  function handleHexChange(next: string) {
    setHex(next.toUpperCase())
    const normalized = normalizedHex(next)
    if (normalized) onChange(normalized)
  }

  return (
    <div className="flex w-full max-w-xs items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={event => onChange(event.target.value.toLowerCase())}
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
            onChange(normalized)
          } else {
            setHex(value.toUpperCase())
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
