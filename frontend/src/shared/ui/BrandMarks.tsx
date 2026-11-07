/**
 * Marcas de los servicios con los que se integra el CRM, como SVG en línea:
 * sin assets externos ni una fuente de iconos nueva. Se dibujan con sus
 * colores oficiales y aceptan `className` para medirse como un icono.
 */
interface MarkProps {
  className?: string
}

/** Logotipo de WhatsApp (trazo oficial, verde #25D366). */
export function WhatsAppMark({ className = 'h-5 w-5' }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path
        fill="#25D366"
        d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.885-9.885 9.885m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z"
      />
    </svg>
  )
}

/** Icono de Google Calendar: el marco de cuatro colores con el 31. */
export function GoogleCalendarMark({ className = 'h-5 w-5' }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="20" height="20" rx="3" fill="#fff" />
      <path d="M5 2h14a3 3 0 0 1 3 3v2H2V5a3 3 0 0 1 3-3Z" fill="#4285F4" />
      <path d="M2 7h3v10H2Z" fill="#4285F4" />
      <path d="M19 7h3v10h-3Z" fill="#FBBC04" />
      <path d="M2 17h17v2a3 3 0 0 1-3 3H5a3 3 0 0 1-3-3Z" fill="#34A853" />
      <path d="M19 17h3v2a3 3 0 0 1-3 3Z" fill="#EA4335" />
      <path d="M19 17h3l-3 5Z" fill="#188038" />
      <text x="12" y="15.4" textAnchor="middle" fontSize="8.5" fontWeight="700" fontFamily="Arial, Helvetica, sans-serif" fill="#4285F4">31</text>
    </svg>
  )
}

/** Marca de ElevenLabs: las dos barras verticales de su logotipo. */
export function ElevenLabsMark({ className = 'h-5 w-5' }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <rect x="6" y="3" width="4" height="18" rx="1" fill="currentColor" />
      <rect x="14" y="3" width="4" height="18" rx="1" fill="currentColor" />
    </svg>
  )
}
