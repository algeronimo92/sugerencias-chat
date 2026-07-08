import { MapPin } from 'lucide-react'
import { getStaticMapTile } from '../utils/staticMap'

interface Props {
  latitude: number
  longitude: number
  zoom?: number
  className?: string
}

export function MapPreview({ latitude, longitude, zoom = 16, className = '' }: Props) {
  const { url, markerXPercent, markerYPercent } = getStaticMapTile(latitude, longitude, zoom)

  return (
    <div className={`relative aspect-square overflow-hidden bg-gray-100 dark:bg-gray-800 ${className}`}>
      <img src={url} alt="Vista previa del mapa" className="w-full h-full object-cover" loading="lazy" />
      <MapPin
        className="absolute w-7 h-7 text-red-600 drop-shadow-md -translate-x-1/2 -translate-y-full pointer-events-none"
        style={{ left: `${markerXPercent}%`, top: `${markerYPercent}%` }}
        fill="currentColor"
      />
      <span className="absolute bottom-0.5 right-1 text-[9px] leading-none text-gray-600 dark:text-gray-300 bg-white/70 dark:bg-black/50 px-1 py-0.5 rounded">
        © OpenStreetMap
      </span>
    </div>
  )
}
