const STATUS_COLORS: Record<string, string> = {
  calificacion: 'bg-blue-100 text-blue-800',
  interesado: 'bg-green-100 text-green-800',
  objecion: 'bg-yellow-100 text-yellow-800',
  cierre: 'bg-purple-100 text-purple-800',
  perdido: 'bg-red-100 text-red-700',
  cliente: 'bg-emerald-100 text-emerald-800',
}

const CONFIANZA_COLORS: Record<string, string> = {
  alta: 'bg-green-100 text-green-700',
  media: 'bg-yellow-100 text-yellow-700',
  baja: 'bg-red-100 text-red-700',
}

interface Props {
  estado: string
  confianza: string
}

export function LeadStatus({ estado, confianza }: Props) {
  const estadoColor = STATUS_COLORS[estado.toLowerCase()] ?? 'bg-gray-100 text-gray-700'
  const confianzaColor = CONFIANZA_COLORS[confianza.toLowerCase()] ?? 'bg-gray-100 text-gray-700'

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
