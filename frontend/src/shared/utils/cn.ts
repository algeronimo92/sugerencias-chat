import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

/** Combina clases condicionales sin dejar utilidades Tailwind en conflicto. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
