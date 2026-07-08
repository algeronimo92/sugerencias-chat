const STATUS_COLORS: Record<string, string> = {
  calificacion: 'bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-400',
  interesado: 'bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-400',
  objecion: 'bg-yellow-100 dark:bg-yellow-950/50 text-yellow-800 dark:text-yellow-400',
  cierre: 'bg-purple-100 dark:bg-purple-950/50 text-purple-800 dark:text-purple-400',
  perdido: 'bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400',
  cliente: 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-400',
}

const CONFIANZA_COLORS: Record<string, string> = {
  alta: 'bg-green-100 dark:bg-green-950/50 text-green-700 dark:text-green-400',
  media: 'bg-yellow-100 dark:bg-yellow-950/50 text-yellow-700 dark:text-yellow-400',
  baja: 'bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400',
}

interface Props {
  estado: string
  confianza: string
}

export function LeadStatus({ estado, confianza }: Props) {
  const estadoColor = STATUS_COLORS[estado.toLowerCase()] ?? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
  const confianzaColor = CONFIANZA_COLORS[confianza.toLowerCase()] ?? 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold capitalize ${estadoColor}`}>
        {estado}
      </span>
      <span className={`inline-block px-3 py-1 rounded-full text-xs font-semibold capitalize ${confianzaColor}`}>
        Confianza: {confianza}
      </span>
    </div>
  )
}
