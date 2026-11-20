import { useState } from 'react'
import { cn } from '../utils/cn'

// Ocho tonos validados a 4,5:1 (iniciales sobre fondo) en claro y en oscuro.
// El fondo suave y el texto del mismo matiz: se distinguen los leads sin que
// la lista se vuelva un arcoíris.
const TONES = [
  'bg-[#e3f2ec] text-[#0b5e47] dark:bg-[#12322a] dark:text-[#7fd6b6]',
  'bg-[#e6eefb] text-[#1e4fae] dark:bg-[#172a4a] dark:text-[#9cc2f7]',
  'bg-[#f1e8fb] text-[#5b2a9a] dark:bg-[#2c1d42] dark:text-[#c9a8f2]',
  'bg-[#fbe8ee] text-[#9c1f4b] dark:bg-[#3f1824] dark:text-[#f2a3bd]',
  'bg-[#fdf0e1] text-[#8a4209] dark:bg-[#3a2610] dark:text-[#f2bd84]',
  'bg-[#e6f4f7] text-[#0d5c6e] dark:bg-[#123039] dark:text-[#89d0e0]',
  'bg-[#eef1e2] text-[#4d5a12] dark:bg-[#272d12] dark:text-[#c3d17d]',
  'bg-[#eceef1] text-[#3d4852] dark:bg-[#252d34] dark:text-[#b9c3cb]',
] as const

const SIZES = {
  sm: 'h-8 w-8 text-xs',
  md: 'h-11 w-11 text-sm',
  lg: 'h-14 w-14 text-base',
} as const

function hash(value: string): number {
  let result = 0
  for (let index = 0; index < value.length; index++) result = (result * 31 + value.charCodeAt(index)) | 0
  return Math.abs(result)
}

function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(word => /\p{L}|\p{N}/u.test(word))
  if (words.length === 0) return '?'
  const first = words[0][0] ?? ''
  const last = words.length > 1 ? words[words.length - 1][0] ?? '' : ''
  return (first + last).toUpperCase()
}

interface Props {
  name: string
  /** Lo que decide el color; por defecto, el nombre. Usar el id del lead para que no cambie al renombrar. */
  seed?: string
  src?: string | null
  size?: keyof typeof SIZES
  className?: string
}

/** Foto redonda o, sin foto, iniciales sobre un tono estable por persona. Decorativo: el nombre va al lado. */
export function Avatar({ name, seed, src, size = 'md', className }: Props) {
  const [failed, setFailed] = useState(false)
  const base = cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold', SIZES[size], className)
  if (src && !failed) {
    return <img src={src} alt="" aria-hidden="true" className={cn(base, 'object-cover')} onError={() => setFailed(true)} />
  }
  return (
    <span aria-hidden="true" className={cn(base, TONES[hash(seed ?? name) % TONES.length])}>
      {initials(name)}
    </span>
  )
}
