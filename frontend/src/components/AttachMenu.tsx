import { useEffect, useRef, useState } from 'react'
import { FileText, Headphones, Image, Loader2, MapPin, Paperclip } from 'lucide-react'

interface Props {
  disabled?: boolean
  isSending?: boolean
  onSelectDocument: () => void
  onSelectMedia: () => void
  onSelectAudio: () => void
  onSelectLocation: () => void
}

const ITEMS = [
  { key: 'document', label: 'Documento', icon: FileText, color: 'bg-violet-600' },
  { key: 'media', label: 'Fotos y videos', icon: Image, color: 'bg-blue-500' },
  { key: 'audio', label: 'Audio', icon: Headphones, color: 'bg-pink-500' },
  { key: 'location', label: 'Ubicación', icon: MapPin, color: 'bg-red-500' },
] as const

export function AttachMenu({
  disabled,
  isSending,
  onSelectDocument,
  onSelectMedia,
  onSelectAudio,
  onSelectLocation,
}: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    function onEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    document.addEventListener('keydown', onEscape)
    return () => {
      document.removeEventListener('mousedown', onClickOutside)
      document.removeEventListener('keydown', onEscape)
    }
  }, [isOpen])

  function handleSelect(key: (typeof ITEMS)[number]['key']) {
    setIsOpen(false)
    if (key === 'document') onSelectDocument()
    else if (key === 'media') onSelectMedia()
    else if (key === 'audio') onSelectAudio()
    else onSelectLocation()
  }

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((v) => !v)}
        disabled={disabled}
        aria-label="Adjuntar archivo"
        className="shrink-0 w-9 h-9 flex items-center justify-center rounded-lg bg-wa-field dark:bg-wa-head-dark text-gray-600 dark:text-gray-300 hover:bg-wa-border dark:hover:bg-wa-active-dark disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {isSending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
      </button>

      {isOpen && (
        <div className="absolute bottom-full left-0 mb-2 w-52 bg-white dark:bg-wa-head-dark rounded-xl shadow-lg border border-wa-border dark:border-wa-border-dark py-1.5 z-10">
          {ITEMS.map(({ key, label, icon: Icon, color }) => (
            <button
              key={key}
              type="button"
              onClick={() => handleSelect(key)}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm text-gray-700 dark:text-wa-text-dark hover:bg-wa-hover dark:hover:bg-wa-active-dark/60 transition-colors"
            >
              <span className={`w-8 h-8 rounded-full flex items-center justify-center text-white shrink-0 ${color}`}>
                <Icon className="w-4 h-4" />
              </span>
              {label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
