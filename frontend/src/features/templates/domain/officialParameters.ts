/** Qué puede llevar cada variable de una plantilla oficial: datos del lead,
 *  datos de la cita y texto libre. Se guarda como texto con variables de
 *  mensaje (`{{nombre}}`, `{{cita.fecha_larga}}`); el armador lo muestra como
 *  piezas. Los ejemplos son los que el backend le manda a Meta para revisar
 *  la plantilla (catalogs/template_validation.py). */

export interface ParameterSource {
  key: string
  label: string
  sample: string
}

export const LEAD_SOURCES: ParameterSource[] = [
  { key: 'nombre', label: 'Nombre', sample: 'Ana' },
  { key: 'telefono', label: 'Teléfono', sample: '51987654321' },
  { key: 'servicio', label: 'Servicio de interés', sample: 'Limpieza facial' },
  { key: 'vendedor', label: 'Vendedor', sample: 'Grecia' },
  { key: 'fecha_actual', label: 'Fecha de hoy', sample: '12/11/2026' },
]

export const APPOINTMENT_SOURCES: ParameterSource[] = [
  { key: 'cita.nombre_completo', label: 'Contacto', sample: 'Ana Pérez' },
  { key: 'cita.dni', label: 'DNI', sample: '45678912' },
  { key: 'cita.telefono', label: 'Teléfono', sample: '987654321' },
  { key: 'cita.tratamiento', label: 'Servicio', sample: 'Limpieza facial' },
  { key: 'cita.detalle', label: 'Detalle', sample: 'Primera sesión' },
  { key: 'cita.vendedor', label: 'Responsable', sample: 'Grecia' },
  { key: 'cita.adelanto', label: 'Adelanto', sample: '50' },
  { key: 'cita.fecha', label: 'Fecha (12/11/2026)', sample: '12/11/2026' },
  { key: 'cita.fecha_larga', label: 'Fecha larga (JUEVES 12 de Noviembre)', sample: 'JUEVES 12 de Noviembre' },
  { key: 'cita.hora', label: 'Hora (13:00)', sample: '13:00' },
  { key: 'cita.hora_12h', label: 'Hora (01:00 Pm)', sample: '01:00 Pm' },
  { key: 'cita.hora_fin', label: 'Hora de fin', sample: '15:00' },
  { key: 'cita.horario', label: 'Horario (de 13:00 a 15:00)', sample: 'de 13:00 a 15:00' },
  { key: 'cita.duration_minutes', label: 'Duración (min)', sample: '120' },
]

const ALL_SOURCES = [...LEAD_SOURCES, ...APPOINTMENT_SOURCES]

export const PARAMETER_KEYS = new Set(ALL_SOURCES.map(source => source.key))

/** Cómo se nombra cada dato dentro de una variable: los de la cita llevan
 *  "Cita ·" para no confundir su teléfono o servicio con los del lead. */
export const PARAMETER_LABELS = new Map(ALL_SOURCES.map(source => [
  source.key,
  source.key.startsWith('cita.') ? `Cita · ${source.label}` : `Lead · ${source.label}`,
]))

const SAMPLES = new Map(ALL_SOURCES.map(source => [source.key, source.sample]))

/** `{{cita.fecha}} a las 10` → `{cita.fecha} a las 10`: la forma que leen
 *  las piezas. */
export function toPieceText(value: string): string {
  return value.replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/g, '{$1}')
}

export function fromPieceText(value: string): string {
  return value.replace(/\{([a-z0-9_.]+)\}/g, '{{$1}}')
}

/** El ejemplo de una variable como lo revisa Meta. */
export function sampleOf(value: string): string {
  return value
    .replace(/\{\{\s*([a-z0-9_.]+)\s*\}\}/g, (whole, key: string) => SAMPLES.get(key) ?? whole)
    .split(/\s+/).filter(Boolean).join(' ')
}
