import { useEffect, useState } from 'react'
import { Loader2, X } from 'lucide-react'
import type { LeadUpdateInput } from '../types'
import { useMe } from '../hooks/useAuth'
import { useSellers } from '../hooks/useUsers'

interface Props {
  title: string
  submitLabel: string
  initial?: LeadUpdateInput
  requirePhoneAndName?: boolean
  isSubmitting: boolean
  error?: string | null
  onSubmit: (values: LeadUpdateInput) => void
  onCancel: () => void
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const FIELD_CLASS =
  'w-full text-sm bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-gray-100 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent placeholder:text-gray-400 dark:placeholder:text-gray-500'

const LABEL_CLASS = 'block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1'

export function LeadFormDialog({
  title,
  submitLabel,
  initial,
  requirePhoneAndName,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
}: Props) {
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [servicioInteres, setServicioInteres] = useState(initial?.servicio_interes ?? '')
  const [vendedorId, setVendedorId] = useState<number | null>(initial?.vendedor_id ?? null)
  const [origen, setOrigen] = useState(initial?.origen ?? '')
  const [notas, setNotas] = useState(initial?.notas ?? '')
  const { data: me } = useMe()
  const { data: sellers = [] } = useSellers()
  const canEditSeller = me?.role === 'admin' || !!requirePhoneAndName || initial?.vendedor_id == null
  const visibleSellers = me?.role === 'admin' || !canEditSeller
    ? sellers
    : sellers.filter((seller) => seller.id === me?.id)

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel])

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const sellerChanged = vendedorId !== (initial?.vendedor_id ?? null)
    onSubmit({
      phone: requirePhoneAndName ? phone.trim() : emptyToNull(phone),
      name: requirePhoneAndName ? name.trim() : emptyToNull(name),
      servicio_interes: emptyToNull(servicioInteres),
      ...(canEditSeller && (requirePhoneAndName || sellerChanged) ? { vendedor_id: vendedorId } : {}),
      origen: emptyToNull(origen),
      notas: emptyToNull(notas),
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onCancel}>
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-white dark:bg-gray-900 rounded-xl shadow-xl border border-gray-200 dark:border-gray-700 overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 dark:border-gray-800">
          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</p>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cerrar"
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3 max-h-[70vh] overflow-y-auto">
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div>
            <label className={LABEL_CLASS}>Teléfono {requirePhoneAndName && '*'}</label>
            <input
              type="text"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="51987654321"
              required={requirePhoneAndName}
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label className={LABEL_CLASS}>Nombre {requirePhoneAndName && '*'}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nombre del lead"
              required={requirePhoneAndName}
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label className={LABEL_CLASS}>Servicio de interés</label>
            <input
              type="text"
              value={servicioInteres}
              onChange={(e) => setServicioInteres(e.target.value)}
              className={FIELD_CLASS}
            />
          </div>

          <div>
            <label className={LABEL_CLASS}>Vendedor</label>
            <select
              value={vendedorId ?? ''}
              onChange={(e) => setVendedorId(e.target.value ? Number(e.target.value) : null)}
              disabled={!canEditSeller}
              className={FIELD_CLASS}
            >
              <option value="">Sin asignar</option>
              {visibleSellers.map((seller) => (
                <option key={seller.id} value={seller.id}>{seller.name}</option>
              ))}
            </select>
            {!canEditSeller && <p className="mt-1 text-[11px] text-gray-400">Solo un administrador puede reasignar este lead.</p>}
          </div>

          <div>
            <label className={LABEL_CLASS}>Origen</label>
            <input type="text" value={origen} onChange={(e) => setOrigen(e.target.value)} className={FIELD_CLASS} />
          </div>

          <div>
            <label className={LABEL_CLASS}>Notas</label>
            <textarea
              value={notas}
              onChange={(e) => setNotas(e.target.value)}
              rows={3}
              className={`${FIELD_CLASS} resize-none`}
            />
          </div>
        </div>

        <div className="flex border-t border-gray-100 dark:border-gray-800">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 py-2.5 text-sm font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="flex-1 py-2.5 text-sm font-medium text-white bg-green-600 hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5 border-l border-gray-100 dark:border-gray-800"
          >
            {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {submitLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
