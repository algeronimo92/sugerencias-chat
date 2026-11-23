import type { InteractiveLimits } from '../types'
import type { TemplateFormState } from './templateForm'

/**
 * Cuánto texto admite cada campo de una plantilla (2026-11-23).
 *
 * Espejo de `catalogs/template_validation.py`. Los del mensaje interactivo
 * (cuerpo, botones, listas) no están acá: los manda el backend en
 * `/api/templates/capabilities` porque salen del contrato de Meta.
 *
 * Antes cada `<input>` repetía su número y solo el mensaje mostraba cuánto
 * llevaba escrito: en el resto el tope se descubría al chocar con él, o al
 * guardar. Ahora todos los campos con tope muestran el contador.
 */
export const TEMPLATE_LIMITS = {
  name: 120,
  shortcut: 50,
  category: 60,
  officialName: 512,
  officialHeaderText: 60,
  officialFooter: 60,
  officialButtonText: 25,
  officialButtonUrl: 2000,
  /** Código de país + número, con los espacios y signos que se suelen escribir. */
  officialButtonPhone: 20,
} as const

/** El tope del texto del mensaje: el de un texto suelto de WhatsApp, o el
 *  del cuerpo cuando es oficial o lleva botones o lista. */
export function contentLimit(
  form: Pick<TemplateFormState, 'templateType' | 'interactiveType'>,
  limits: InteractiveLimits | undefined,
): number | undefined {
  const plainText = form.templateType === 'internal' && form.interactiveType === 'none'
  return plainText ? limits?.text : limits?.body
}

/** Id del control principal de cada campo: adonde va el foco al guardar con
 *  errores. */
export const fieldId = (field: string) => `template-field-${field}`

export type CounterTone ='calm' | 'near' | 'full' | 'over'

/** Cómo se muestra el contador: tranquilo, cerca del tope (desde el 90 %),
 *  en el tope, o pasado (un texto que ya venía largo al cambiar de tipo). */
export function counterTone(length: number, max: number): CounterTone {
  if (length > max) return 'over'
  if (length === max) return 'full'
  return length >= Math.ceil(max * 0.9) ? 'near' : 'calm'
}
