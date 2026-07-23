/** Normalización de teléfonos de leads a E.164.
 * Espejo de backend/services/phone_utils.py — mismas reglas y mensajes;
 * cualquier cambio allá debe replicarse acá. El backend re-normaliza igual:
 * esto existe solo para validación y preview en vivo en el formulario. */

export type PhoneCheck =
  | { status: 'empty' }
  | { status: 'invalid'; error: string }
  | { status: 'valid'; digits: string; preview: string }

export const FALLBACK_COUNTRY_CODE = '51'

/** Formato local por código de país (espejo de LOCAL_RULES del backend).
 * Perú: celulares de 9 dígitos que empiezan con 9, o fijos de 8 dígitos
 * (área 1 = Lima, o 2 dígitos 41-87 = provincias). */
const LOCAL_RULES: Record<string, { pattern: RegExp; error: string; maxDigits: number }> = {
  '51': {
    pattern: /^(?:9\d{8}|[14-8]\d{7})$/,
    error: 'Revisá el número: en Perú los celulares tienen 9 dígitos (empiezan con 9) y los fijos 8',
    maxDigits: 9,
  },
}

/** Tope de dígitos para un número local del país configurado (null = sin regla). */
export function localMaxDigits(countryCode: string): number | null {
  return LOCAL_RULES[countryCode]?.maxDigits ?? null
}

export function normalizePhone(raw: string, defaultCountryCode: string): PhoneCheck {
  const stripped = raw.trim()
  if (!stripped) return { status: 'empty' }
  if (/[A-Za-z]/.test(stripped)) {
    return { status: 'invalid', error: 'El teléfono no puede contener letras' }
  }

  let digits = stripped.replace(/\D/g, '')
  if (!digits) return { status: 'empty' }

  const cc = defaultCountryCode.replace(/\D/g, '') || FALLBACK_COUNTRY_CODE
  const hasCountryCode = stripped.startsWith('+') || (digits.startsWith(cc) && digits.length >= cc.length + 8)
  let local: string | null
  if (hasCountryCode) {
    local = digits.startsWith(cc) ? digits.slice(cc.length) : null
  } else {
    // El "0" inicial es el prefijo nacional ("01 234 5678"): no forma parte
    // del número internacional.
    local = digits.startsWith('0') ? digits.slice(1) : digits
    digits = cc + local
  }

  const rule = LOCAL_RULES[cc]
  if (rule && local != null && !rule.pattern.test(local)) {
    return { status: 'invalid', error: rule.error }
  }

  if (!/^[1-9]\d{7,14}$/.test(digits)) {
    return { status: 'invalid', error: 'Revisá el número: debe tener entre 8 y 15 dígitos' }
  }
  return { status: 'valid', digits, preview: formatPhonePreview(digits, cc) }
}

/** "+51 906 471 403" — código de país separado y el resto en grupos de 3. */
export function formatPhonePreview(digits: string, cc: string): string {
  const rest = digits.startsWith(cc) ? digits.slice(cc.length) : digits
  const prefix = digits.startsWith(cc) ? cc : ''
  const groups = rest.match(/.{1,3}/g) ?? []
  return `+${[prefix, ...groups].filter(Boolean).join(' ')}`
}

export function digitsToJid(digits: string): string {
  return `${digits}@s.whatsapp.net`
}
