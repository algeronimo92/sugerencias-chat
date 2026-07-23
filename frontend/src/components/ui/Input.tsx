import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react'

/**
 * Clase compartida de campos de formulario (reemplaza los FIELD_CLASS que
 * estaban duplicados en LoginPage/ChatList/ChatThread/SettingsDialog).
 * Estética WhatsApp: campo gris suave, foco en verde de marca.
 */
export const fieldClass =
  'w-full text-sm bg-wa-field dark:bg-wa-field-dark text-wa-text dark:text-wa-text-dark border border-transparent rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-wa-primary/60 focus:border-transparent placeholder:text-wa-muted dark:placeholder:text-wa-muted-dark transition-shadow'

/** Variante en píldora (búsqueda estilo WhatsApp). */
export const pillFieldClass =
  'w-full text-sm bg-wa-field dark:bg-wa-field-dark text-wa-text dark:text-wa-text-dark border border-transparent rounded-full px-3 py-1.5 outline-none focus:ring-2 focus:ring-wa-primary/60 placeholder:text-wa-muted dark:placeholder:text-wa-muted-dark transition-shadow'

export const labelClass = 'block text-xs font-medium text-wa-muted dark:text-wa-muted-dark mb-1'

export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${fieldClass} ${className}`} {...rest} />
}

export function Textarea({ className = '', ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${fieldClass} ${className}`} {...rest} />
}

export function Select({ className = '', ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={`${fieldClass} ${className}`} {...rest} />
}
