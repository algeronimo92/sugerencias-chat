import { cn } from '../../../shared/utils/cn'

/** Clases del medio que nace invisible encima del placeholder y se revela con
 * un fundido corto (200 ms, ease-out) al cargar. Con prefers-reduced-motion
 * dura 0 (regla global en index.css). */
export function revealClass(loaded: boolean, extra?: string): string {
  return cn('h-full w-full object-cover transition-opacity duration-200 ease-out', loaded ? 'opacity-100' : 'opacity-0', extra)
}
