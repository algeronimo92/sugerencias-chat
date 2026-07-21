const STATUS_COLORS: Record<string, string> = {
  nuevo: 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300',
  en_diagnostico: 'bg-blue-100 dark:bg-blue-950/50 text-blue-800 dark:text-blue-400',
  calificado: 'bg-cyan-100 dark:bg-cyan-950/50 text-cyan-800 dark:text-cyan-400',
  oferta_presentada: 'bg-purple-100 dark:bg-purple-950/50 text-purple-800 dark:text-purple-400',
  en_objecion: 'bg-yellow-100 dark:bg-yellow-950/50 text-yellow-800 dark:text-yellow-400',
  agendado: 'bg-indigo-100 dark:bg-indigo-950/50 text-indigo-800 dark:text-indigo-400',
  cliente_activo: 'bg-green-100 dark:bg-green-950/50 text-green-800 dark:text-green-400',
  postventa: 'bg-emerald-100 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-400',
  en_seguimiento: 'bg-amber-100 dark:bg-amber-950/50 text-amber-800 dark:text-amber-400',
  en_nutricion: 'bg-sky-100 dark:bg-sky-950/50 text-sky-800 dark:text-sky-400',
  perdido: 'bg-red-100 dark:bg-red-950/50 text-red-700 dark:text-red-400',
  descalificado: 'bg-rose-100 dark:bg-rose-950/50 text-rose-800 dark:text-rose-400',
  baja: 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-400',
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
