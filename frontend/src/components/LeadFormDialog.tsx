import { useEffect, useMemo, useState } from 'react'
import { Loader2, MessageCircle, X } from 'lucide-react'
import type { Chat, LeadUpdateInput } from '../types'
import { useMe } from '../hooks/useAuth'
import { useSellers } from '../hooks/useUsers'
import { useDuplicateLead, usePhoneConfig } from '../hooks/useChats'
import { FALLBACK_COUNTRY_CODE, normalizePhone } from '../utils/phone'
import { Button, fieldClass, labelClass } from './ui'

interface Props {
  title: string
  submitLabel: string
  initial?: LeadUpdateInput
  requirePhoneAndName?: boolean
  /** false cuando el lead ya tiene conversación: el número es la identidad
   * del chat en WhatsApp y el backend rechaza cambiarlo. */
  canEditPhone?: boolean
  isSubmitting: boolean
  error?: string | null
  onSubmit: (values: LeadUpdateInput) => void
  onCancel: () => void
  /** Al detectar que el número ya está cargado, abre ese chat en vez de crear. */
  onOpenExisting?: (chat: Chat) => void
}

function emptyToNull(value: string): string | null {
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

const FIELD_CLASS = fieldClass

const LABEL_CLASS = labelClass

export function LeadFormDialog({
  title,
  submitLabel,
  initial,
  requirePhoneAndName,
  canEditPhone = true,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
  onOpenExisting,
}: Props) {
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [servicioInteres, setServicioInteres] = useState(initial?.servicio_interes ?? '')
  const [vendedorId, setVendedorId] = useState<number | null>(initial?.vendedor_id ?? null)
  const [origen, setOrigen] = useState(initial?.origen ?? '')
  const [notas, setNotas] = useState(initial?.notas ?? '')
  const [debouncedDigits, setDebouncedDigits] = useState<string | null>(null)
  const { data: me } = useMe()
  const { data: sellers = [] } = useSellers()
  const { data: phoneConfig } = usePhoneConfig()
  const countryCode = phoneConfig?.default_country_code ?? FALLBACK_COUNTRY_CODE
  const canEditSeller = me?.role === 'admin' || !!requirePhoneAndName || initial?.vendedor_id == null
  const visibleSellers = me?.role === 'admin' || !canEditSeller
    ? sellers
    : sellers.filter((seller) => seller.id === me?.id)

  const phoneCheck = useMemo(
    () => (canEditPhone ? normalizePhone(phone, countryCode) : { status: 'empty' as const }),
    [phone, countryCode, canEditPhone],
  )
  // El número original no cuenta como duplicado al editar sin cambiarlo.
  const initialDigits = useMemo(() => (initial?.phone ?? '').replace(/\D/g, ''), [initial?.phone])
  const candidateDigits =
    phoneCheck.status === 'valid' && phoneCheck.digits !== initialDigits ? phoneCheck.digits : null

  useEffect(() => {
    const timeout = setTimeout(() => setDebouncedDigits(candidateDigits), 400)
    return () => clearTimeout(timeout)
  }, [candidateDigits])

  const { data: duplicate, isFetching: isCheckingDuplicate } = useDuplicateLead(
    candidateDigits === debouncedDigits ? debouncedDigits : null,
  )
  const duplicateBlocks = !!duplicate && candidateDigits === debouncedDigits

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !isSubmitting) onCancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onCancel, isSubmitting])

  // El prefijo visual +51 solo aparece cuando efectivamente se va a anteponer
  // (mismo criterio que normalizePhone) — con un número ya internacional
  // duplicaría el código en pantalla.
  const typedDigits = phone.trim().replace(/\D/g, '')
  const showPrefix =
    canEditPhone &&
    !phone.trim().startsWith('+') &&
    !(typedDigits.startsWith(countryCode) && typedDigits.length >= countryCode.length + 8)

  const phoneInvalid = phoneCheck.status === 'invalid'
  const submitDisabled =
    isSubmitting || (canEditPhone && (phoneInvalid || duplicateBlocks || (!!requirePhoneAndName && phoneCheck.status !== 'valid')))

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (isSubmitting || submitDisabled) return
    const sellerChanged = vendedorId !== (initial?.vendedor_id ?? null)
    onSubmit({
      // Se mandan los dígitos ya normalizados (el backend re-normaliza igual).
      // Con el teléfono bloqueado no viaja el campo: evita un re-key accidental.
      ...(canEditPhone
        ? { phone: phoneCheck.status === 'valid' ? phoneCheck.digits : emptyToNull(phone) }
        : {}),
      name: requirePhoneAndName ? name.trim() : emptyToNull(name),
      servicio_interes: emptyToNull(servicioInteres),
      ...(canEditSeller && (requirePhoneAndName || sellerChanged) ? { vendedor_id: vendedorId } : {}),
      origen: emptyToNull(origen),
      notas: emptyToNull(notas),
    })
  }

  const noWhatsappError = !!error && error.includes('no tiene WhatsApp')

  return (
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
      onClick={() => {
        if (!isSubmitting) onCancel()
      }}
    >
      <form
        onSubmit={handleSubmit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm bg-white dark:bg-wa-panel-dark rounded-xl shadow-xl border border-wa-border dark:border-wa-border-dark overflow-hidden"
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-wa-border dark:border-wa-border-dark">
          <p className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">{title}</p>
          <button
            type="button"
            onClick={onCancel}
            disabled={isSubmitting}
            aria-label="Cerrar"
            className="text-wa-muted hover:text-gray-600 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-4 py-3 space-y-3 max-h-[70vh] overflow-y-auto">
          {error && !noWhatsappError && (
            <p className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-900 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <div>
            <label className={LABEL_CLASS}>Teléfono {requirePhoneAndName && '*'}</label>
            <div className="relative">
              {showPrefix && (
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-wa-muted dark:text-wa-muted-dark pointer-events-none">
                  +{countryCode}
                </span>
              )}
              <input
                type="text"
                inputMode="tel"
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="906 471 403"
                required={requirePhoneAndName}
                disabled={!canEditPhone}
                className={`${FIELD_CLASS} disabled:opacity-60`}
                style={showPrefix ? { paddingLeft: `${1.5 + countryCode.length * 0.6}rem` } : undefined}
              />
            </div>
            {!canEditPhone && (
              <p className="mt-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">
                No se puede cambiar el teléfono porque ya hay conversación en WhatsApp.
              </p>
            )}
            {canEditPhone && noWhatsappError && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{error}</p>
            )}
            {canEditPhone && phoneInvalid && (
              <p className="mt-1 text-xs text-red-600 dark:text-red-400">{phoneCheck.error}</p>
            )}
            {canEditPhone && phoneCheck.status === 'valid' && !duplicateBlocks && (
              isCheckingDuplicate ? (
                <p className="mt-1 text-xs text-wa-muted dark:text-wa-muted-dark flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" />
                  Comprobando si ya existe…
                </p>
              ) : (
                <p className="mt-1 text-xs text-wa-primary-strong dark:text-wa-primary">
                  Lo guardamos como {phoneCheck.preview}
                </p>
              )
            )}
            {canEditPhone && duplicateBlocks && duplicate && (
              <div className="mt-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
                <p className="text-xs text-amber-800 dark:text-amber-300 mb-1.5">
                  Este número ya está cargado: <span className="font-semibold">{duplicate.name || duplicate.phone}</span>
                </p>
                {onOpenExisting && (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onOpenExisting(duplicate)}
                    className="w-full"
                  >
                    <MessageCircle className="w-3.5 h-3.5" />
                    Abrir chat existente
                  </Button>
                )}
              </div>
            )}
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
            {!canEditSeller && <p className="mt-1 text-[11px] text-wa-muted">Solo un administrador puede reasignar este lead.</p>}
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

        <div className="flex border-t border-wa-border dark:border-wa-border-dark">
          <Button
            variant="ghost"
            onClick={onCancel}
            disabled={isSubmitting}
            className="flex-1 rounded-none h-11"
          >
            Cancelar
          </Button>
          <Button
            type="submit"
            variant="primary"
            disabled={submitDisabled}
            className="flex-1 rounded-none h-11 border-l border-wa-border dark:border-wa-border-dark"
          >
            {isSubmitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {isSubmitting && requirePhoneAndName ? 'Verificando WhatsApp…' : submitLabel}
          </Button>
        </div>
      </form>
    </div>
  )
}
