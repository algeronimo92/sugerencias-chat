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

/** Estrella de cuatro puntas de Gemini, con su degradado azul a violeta. */
export function GeminiMark({ className = 'h-5 w-5' }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="gemini-mark-gradient" x1="0" y1="24" x2="24" y2="0" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#1C7DFF" />
          <stop offset="0.52" stopColor="#1C69FF" />
          <stop offset="1" stopColor="#F0DCD6" />
        </linearGradient>
      </defs>
      <path
        fill="url(#gemini-mark-gradient)"
        d="M12 24A14.3 14.3 0 0 0 0 12 14.3 14.3 0 0 0 12 0a14.3 14.3 0 0 0 12 12 14.3 14.3 0 0 0-12 12Z"
      />
    </svg>
  )
}

/** Logotipo de OpenAI (el nudo hexagonal), en el color del texto. */
export function OpenAIMark({ className = 'h-5 w-5' }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z"
      />
    </svg>
  )
}

/** Infinito de Meta, en su azul #0081FB. */
export function MetaMark({ className = 'h-5 w-5' }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path
        d="M12 12c-1.9-3.1-3.6-5-5.6-5C4.4 7 2.5 9.2 2.5 12.2c0 2.6 1.4 4.3 3.4 4.3 2.2 0 3.9-2.2 6.1-5.6 2.2-3.4 3.9-3.9 5.2-3.9 2.2 0 4.3 2.4 4.3 5.4 0 2.6-1.4 4.1-3.3 4.1-2 0-3.7-2-6.2-4.5Z"
        fill="none"
        stroke="#0081FB"
        strokeWidth="2.4"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** "G" de cuatro colores de Google. */
export function GoogleMark({ className = 'h-5 w-5' }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82Z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24Z" />
      <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09Z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96Z" />
    </svg>
  )
}

/** Los cuatro cuadrados de Microsoft. */
export function MicrosoftMark({ className = 'h-5 w-5' }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <rect x="2" y="2" width="9.5" height="9.5" fill="#F25022" />
      <rect x="12.5" y="2" width="9.5" height="9.5" fill="#7FBA00" />
      <rect x="2" y="12.5" width="9.5" height="9.5" fill="#00A4EF" />
      <rect x="12.5" y="12.5" width="9.5" height="9.5" fill="#FFB900" />
    </svg>
  )
}

/** Los cuatro bloques de colores de Zoho. */
export function ZohoMark({ className = 'h-5 w-5' }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <rect x="1" y="8" width="5" height="8" rx="1" fill="#E42527" transform="rotate(-8 3.5 12)" />
      <rect x="7" y="8" width="5" height="8" rx="1" fill="#089949" transform="rotate(6 9.5 12)" />
      <rect x="12.5" y="8" width="5" height="8" rx="1" fill="#226DB4" transform="rotate(-6 15 12)" />
      <rect x="18" y="8" width="5" height="8" rx="1" fill="#F9B21D" transform="rotate(8 20.5 12)" />
    </svg>
  )
}

/** Nodos conectados de n8n, en su rosa #EA4B71. */
export function N8nMark({ className = 'h-5 w-5' }: MarkProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path
        d="M6.6 12h3.2c1.8 0 1.9-5 4.2-5h1.6M9.8 12c1.8 0 1.9 5 4.2 5h1.6"
        fill="none"
        stroke="#EA4B71"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <circle cx="4.3" cy="12" r="2.3" fill="#EA4B71" />
      <circle cx="18.2" cy="7" r="2.3" fill="#EA4B71" />
      <circle cx="18.2" cy="17" r="2.3" fill="#EA4B71" />
    </svg>
  )
}
