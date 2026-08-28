import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, MessageCircle, Plus, X } from 'lucide-react'
import type { Chat, LeadService, LeadUpdateInput } from '../types'
import { useMe } from '../hooks/useAuth'
import { useSellers } from '../hooks/useUsers'
import { useDuplicateLead, usePhoneConfig } from '../hooks/useChats'
import { useCreateLeadService, useLeadServices } from '../hooks/useLeadServices'
import { FALLBACK_COUNTRY_CODE, localMaxDigits, normalizePhone } from '../utils/phone'
import { toLocalInput } from '../utils/datetime'
import { extractErrorMessage } from '../utils/errors'
import { Button } from './ui/Button'
import { Checkbox } from './ui/Checkbox'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from './ui/Dialog'
import { Select, fieldClass, labelClass } from './ui/Input'


interface Props {
  title: string
  submitLabel: string
  initial?: LeadUpdateInput
  requirePhoneAndName?: boolean
  /** false cuando el lead ya tiene conversación Y teléfono resuelto: el
   * número es la identidad del chat en WhatsApp y cambiarlo lo redirigiría.
   * Sigue en true con conversación activa si el teléfono está en null (un
   * @lid sin resolver) — no hay nada resuelto que se pueda pisar. */
  canEditPhone?: boolean
  /** true solo en ese segundo caso: hay conversación activa pero nunca se
   * resolvió el teléfono. Muestra la advertencia de que un número mal
   * tipeado redirige los próximos mensajes a otra persona. */
  phoneEditIsRisky?: boolean
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
  phoneEditIsRisky = false,
  isSubmitting,
  error,
  onSubmit,
  onCancel,
  onOpenExisting,
}: Props) {
  const [phone, setPhone] = useState(initial?.phone ?? '')
  const [secondaryPhone, setSecondaryPhone] = useState(initial?.secondary_phone ?? '')
  const [name, setName] = useState(initial?.name ?? '')
  const [servicioInteres, setServicioInteres] = useState(initial?.servicio_interes ?? '')
  const [isAddingService, setIsAddingService] = useState(false)
  const [newServiceName, setNewServiceName] = useState('')
  const [createdServices, setCreatedServices] = useState<LeadService[]>([])
  const [serviceError, setServiceError] = useState<string | null>(null)
  const [vendedorId, setVendedorId] = useState<number | null>(initial?.vendedor_id ?? null)
  const [origen, setOrigen] = useState(initial?.origen ?? '')
  const [notas, setNotas] = useState(initial?.notas ?? '')
  const [conEspecialista, setConEspecialista] = useState(initial?.con_especialista ?? false)
  const [razonPerdido, setRazonPerdido] = useState(initial?.razon_perdido ?? '')
  // El backend manda fecha_recontacto como ISO date (YYYY-MM-DD), que es
  // exactamente lo que espera un <input type="date">.
  const [fechaRecontacto, setFechaRecontacto] = useState(initial?.fecha_recontacto ?? '')
  const [proximaCita, setProximaCita] = useState(
    initial?.proxima_cita ? toLocalInput(new Date(initial.proxima_cita)) : '',
  )
  const [debouncedDigits, setDebouncedDigits] = useState<string | null>(null)
  const { data: me } = useMe()
  const { data: sellers = [] } = useSellers()
  const { data: phoneConfig } = usePhoneConfig()
  const { data: leadServices = [], isLoading: areServicesLoading } = useLeadServices()
  const createService = useCreateLeadService()
  const countryCode = phoneConfig?.default_country_code ?? FALLBACK_COUNTRY_CODE
  // requirePhoneAndName solo lo manda el alta de leads: en ese modo el
  // seguimiento (cita, recontacto, pérdida) todavía no tiene nada que decir.
  const isCreating = !!requirePhoneAndName
  const canEditSeller = me?.role === 'admin' || !!requirePhoneAndName || initial?.vendedor_id == null
  const visibleSellers = me?.role === 'admin' || !canEditSeller
    ? sellers
    : sellers.filter((seller) => seller.id === me?.id)
  const availableLeadServices = useMemo(() => {
    const byId = new Map([...leadServices, ...createdServices].map(service => [service.id, service]))
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
  }, [leadServices, createdServices])

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

  function handlePhoneChange(value: string) {
    // Tope de tipeo para el país configurado (Perú: 9 dígitos el celular, +1
    // por el posible "0" nacional; con el 51 adelante, 11). Los números con
    // "+" son internacionales y se validan aparte.
    const max = localMaxDigits(countryCode)
    if (max != null && !value.trim().startsWith('+')) {
      const valueDigits = value.replace(/\D/g, '')
      const limit = valueDigits.startsWith(countryCode)
        ? countryCode.length + max
        : valueDigits.startsWith('0')
          ? max + 1
          : max
      if (valueDigits.length > limit) return
    }
    setPhone(value)
  }

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
      secondary_phone: emptyToNull(secondaryPhone),
      servicio_interes: emptyToNull(servicioInteres),
      ...(canEditSeller && (requirePhoneAndName || sellerChanged) ? { vendedor_id: vendedorId } : {}),
      origen: emptyToNull(origen),
      notas: emptyToNull(notas),
      // Solo al editar: el alta va contra POST /api/chats, que no los acepta.
      ...(isCreating
        ? {}
        : {
            con_especialista: conEspecialista,
            razon_perdido: emptyToNull(razonPerdido),
            fecha_recontacto: emptyToNull(fechaRecontacto),
            // La hora local tipeada se manda en UTC (la columna es timestamptz).
            proxima_cita: proximaCita.trim() ? new Date(proximaCita).toISOString() : null,
          }),
    })
  }

  function handleCreateService() {
    const name = newServiceName.trim()
    if (!name || createService.isPending) return
    setServiceError(null)
    createService.mutate(name, {
      onSuccess: (service) => {
        setCreatedServices(current => [...current.filter(item => item.id !== service.id), service])
        setServicioInteres(service.name)
        setNewServiceName('')
        setIsAddingService(false)
      },
      onError: (err) => setServiceError(extractErrorMessage(err)),
    })
  }

  const noWhatsappError = !!error && error.includes('no tiene WhatsApp')

  return (
    <Dialog.Root open onOpenChange={open => { if (!open && !isSubmitting) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content
          asChild
          onEscapeKeyDown={event => { if (isSubmitting) event.preventDefault() }}
          onPointerDownOutside={event => { if (isSubmitting) event.preventDefault() }}
        >
        <form
        onSubmit={handleSubmit}
        className={`${dialogContentPositionClass} w-[calc(100%-2rem)] max-w-sm overflow-hidden rounded-xl border border-wa-border bg-white shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-wa-border dark:border-wa-border-dark">
          <Dialog.Title className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">{title}</Dialog.Title>
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
                onChange={(e) => handlePhoneChange(e.target.value)}
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
            {canEditPhone && phoneEditIsRisky && (
              <div className="mt-2 flex gap-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/40 px-3 py-2">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <p className="text-xs text-amber-800 dark:text-amber-300">
                  Este chat ya tiene conversación, pero WhatsApp todavía no reveló el teléfono
                  real detrás de él. Si el número que cargás es incorrecto, los próximos mensajes
                  se le van a mandar a otra persona, mientras este chat sigue mostrando la
                  conversación anterior. Confirmalo con el cliente antes de guardar.
                </p>
              </div>
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
            <label htmlFor="lead-secondary-phone" className={LABEL_CLASS}>Teléfono secundario</label>
            <input
              id="lead-secondary-phone"
              type="text"
              inputMode="tel"
              value={secondaryPhone}
              onChange={(e) => setSecondaryPhone(e.target.value)}
              placeholder="Otro número (llamadas, WhatsApp de otra persona, etc.)"
              className={FIELD_CLASS}
            />
            <p className="mt-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">
              Solo para referencia — los mensajes de WhatsApp siempre van al teléfono de arriba.
            </p>
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
            <label htmlFor="lead-service" className={LABEL_CLASS}>Servicio de interés</label>
            <div className="flex items-center gap-2">
            <Select
              id="lead-service"
              value={servicioInteres}
              onChange={(e) => setServicioInteres(e.target.value)}
              disabled={areServicesLoading}
              className="min-w-0 flex-1"
            >
              <option value="">Sin servicio</option>
              {servicioInteres && !availableLeadServices.some(service => service.name === servicioInteres) && (
                <option value={servicioInteres}>{servicioInteres} (valor actual)</option>
              )}
              {availableLeadServices.map(service => (
                <option key={service.id} value={service.name}>{service.name}</option>
              ))}
            </Select>
            <Button
              type="button"
              variant="secondary"
              size="icon"
              onClick={() => { setIsAddingService(current => !current); setServiceError(null) }}
              aria-label={isAddingService ? 'Cancelar nuevo servicio' : 'Crear servicio'}
              title={isAddingService ? 'Cancelar' : 'Crear servicio'}
              className="shrink-0"
            >
              {isAddingService ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            </Button>
            </div>
            {isAddingService && (
              <div className="mt-2 flex items-center gap-2">
                <input
                  autoFocus
                  value={newServiceName}
                  onChange={(event) => setNewServiceName(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault()
                      handleCreateService()
                    }
                  }}
                  maxLength={120}
                  placeholder="Nombre del nuevo servicio"
                  className={`${FIELD_CLASS} min-w-0 flex-1`}
                />
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleCreateService}
                  disabled={!newServiceName.trim() || createService.isPending}
                >
                  {createService.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Crear
                </Button>
              </div>
            )}
            {serviceError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{serviceError}</p>}
          </div>

          <div>
            <label className={LABEL_CLASS}>Vendedor</label>
            <Select
              value={vendedorId ?? ''}
              onChange={(e) => setVendedorId(e.target.value ? Number(e.target.value) : null)}
              disabled={!canEditSeller}
              className={FIELD_CLASS}
            >
              <option value="">Sin asignar</option>
              {visibleSellers.map((seller) => (
                <option key={seller.id} value={seller.id}>{seller.name}</option>
              ))}
            </Select>
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

          {!isCreating && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={LABEL_CLASS}>Próxima cita</label>
                  <input
                    type="datetime-local"
                    value={proximaCita}
                    onChange={(e) => setProximaCita(e.target.value)}
                    className={FIELD_CLASS}
                  />
                </div>
                <div>
                  <label className={LABEL_CLASS}>Fecha de recontacto</label>
                  <input
                    type="date"
                    value={fechaRecontacto}
                    onChange={(e) => setFechaRecontacto(e.target.value)}
                    className={FIELD_CLASS}
                  />
                </div>
              </div>

              <div>
                <label className={LABEL_CLASS}>Razón de pérdida</label>
                <input
                  type="text"
                  value={razonPerdido}
                  onChange={(e) => setRazonPerdido(e.target.value)}
                  maxLength={500}
                  placeholder="Por qué se perdió el lead"
                  className={FIELD_CLASS}
                />
              </div>

              <label className="flex cursor-pointer items-center gap-2 pt-1">
                <Checkbox checked={conEspecialista} onCheckedChange={setConEspecialista} />
                <span className="text-sm text-wa-text dark:text-wa-text-dark">Derivado a un especialista</span>
              </label>
            </>
          )}
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
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
