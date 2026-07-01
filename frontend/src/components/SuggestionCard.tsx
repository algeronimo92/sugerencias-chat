import { useState } from 'react'
import type { Sugerencia } from '../types'

const CANAL_ICON: Record<string, string> = {
  texto: '💬',
  audio: '🎵',
  video: '🎬',
}

interface Props {
  sugerencia: Sugerencia
  index: number
}

export function SuggestionCard({ sugerencia, index }: Props) {
  const [copied, setCopied] = useState(false)
  const [showMotivo, setShowMotivo] = useState(false)

  const valueToCopy = sugerencia.texto ?? ''

  async function handleCopy() {
    if (!valueToCopy) return
    await navigator.clipboard.writeText(valueToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-3 bg-gray-50 border-b border-gray-100">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base">{CANAL_ICON[sugerencia.canal] ?? '💬'}</span>
          <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            Opción {index + 1}
          </span>
        </div>
        {sugerencia.texto && (
          <button
            onClick={handleCopy}
            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-colors shrink-0 ml-2 ${
              copied
                ? 'bg-green-100 text-green-700'
                : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
            }`}
          >
            {copied ? '✓ Copiado' : 'Copiar'}
          </button>
        )}
      </div>

      <div className="p-4 space-y-3">
        {/* Táctica */}
        <p className="text-xs font-semibold text-indigo-600 uppercase tracking-wide">
          {sugerencia.tactica}
        </p>

        {/* Texto sugerido */}
        {sugerencia.texto && (
          <p className="text-sm text-gray-800 leading-relaxed bg-green-50 border border-green-100 rounded-lg p-3 whitespace-pre-wrap">
            {sugerencia.texto}
          </p>
        )}

        {/* Adjuntos */}
        {sugerencia.adjuntos.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs font-medium text-gray-500">Adjuntos:</p>
            {sugerencia.adjuntos.map((url, i) => (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noreferrer"
                className="block text-xs text-blue-600 hover:underline truncate"
              >
                {url}
              </a>
            ))}
          </div>
        )}

        {/* Por qué — expandible */}
        <button
          onClick={() => setShowMotivo(!showMotivo)}
          className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1 transition-colors"
        >
          <span>{showMotivo ? '▲' : '▼'}</span>
          <span>¿Por qué esta táctica?</span>
        </button>
        {showMotivo && (
          <p className="text-xs text-gray-500 italic border-l-2 border-gray-200 pl-3">
            {sugerencia.porque}
          </p>
        )}
      </div>
    </div>
  )
}
