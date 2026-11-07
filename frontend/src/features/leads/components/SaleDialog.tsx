import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Button } from '../../../shared/ui/Button'
import { DialogPrimitive as Dialog, dialogContentPositionClass, dialogOverlayClass } from '../../../shared/ui/Dialog'
import { Input, Select, Textarea, labelClass } from '../../../shared/ui/Input'
import { useLeadServices } from '../../catalogs/public/useLeadServices'
import type { LeadSaleInput } from '../types'

interface Props {
  /** Nombre visible del lead, para el título. */
  leadName: string
  /** El servicio que le interesaba: preselecciona el servicio del paquete. */
  defaultServiceName?: string | null
  /** Etapa ganada a la que se mueve; sin ella el diálogo solo registra. */
  stageName?: string | null
  /** `null` cuando el asesor prefiere mover sin registrar (solo con `allowSkip`). */
  onConfirm: (sale: LeadSaleInput | null) => void
  onCancel: () => void
  allowSkip?: boolean
  isPending?: boolean
}

/**
 * El interés del lead es el servicio (el problema); el cierre es un paquete
 * concreto con su precio. El monto se prellena con el precio de lista y se
 * puede bajar si hubo descuento; el precio de lista queda guardado igual.
 */
export function SaleDialog({ leadName, defaultServiceName, stageName, onConfirm, onCancel, allowSkip = false, isPending = false }: Props) {
  const { data: services = [], isLoading } = useLeadServices()
  // Solo lo vendible: servicios activos con al menos un paquete activo.
  const sellable = useMemo(
    () => services
      .map(service => ({ ...service, packages: (service.packages ?? []).filter(pkg => pkg.is_active) }))
      .filter(service => service.packages.length > 0),
    [services],
  )
  const [serviceId, setServiceId] = useState<string>('')
  const [packageId, setPackageId] = useState<string>('')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (serviceId || sellable.length === 0) return
    const wanted = defaultServiceName?.trim().toLowerCase()
    const match = (wanted && sellable.find(service => service.name.toLowerCase() === wanted)) || (sellable.length === 1 ? sellable[0] : null)
    if (match) setServiceId(String(match.id))
  }, [sellable, defaultServiceName, serviceId])

  const service = sellable.find(item => String(item.id) === serviceId) ?? null
  const pkg = service?.packages.find(item => String(item.id) === packageId) ?? null

  useEffect(() => {
    // Al cambiar de servicio, si hay un solo paquete se elige solo.
    if (!service) return
    if (!service.packages.some(item => String(item.id) === packageId)) {
      const only = service.packages.length === 1 ? service.packages[0] : null
      setPackageId(only ? String(only.id) : '')
      setAmount(only ? only.price : '')
    }
  }, [service, packageId])

  function choosePackage(nextId: string) {
    setPackageId(nextId)
    const chosen = service?.packages.find(item => String(item.id) === nextId)
    setAmount(chosen ? chosen.price : '')
    setError(null)
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    if (!service || !pkg) {
      setError('Elige el servicio y el paquete que compró')
      return
    }
    const trimmed = amount.trim()
    if (trimmed !== '' && !(Number(trimmed) >= 0)) {
      setError('El monto debe ser un número mayor o igual a cero')
      return
    }
    setError(null)
    onConfirm({
      service_id: service.id,
      package_id: pkg.id,
      amount: trimmed === '' ? null : trimmed,
      notes: notes.trim() || null,
    })
  }

  const title = stageName ? `Mover a ${stageName}` : 'Registrar compra'
  const confirmLabel = stageName ? `Mover y registrar` : 'Registrar compra'

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onCancel() }}>
      <Dialog.Portal>
        <Dialog.Overlay className={dialogOverlayClass} />
        <Dialog.Content asChild>
          <form
            onSubmit={handleSubmit}
            className={`${dialogContentPositionClass} w-[calc(100%-2rem)] max-w-md overflow-hidden rounded-xl border border-wa-border bg-white shadow-xl dark:border-wa-border-dark dark:bg-wa-panel-dark`}
          >
            <div className="flex items-center justify-between border-b border-wa-border px-4 py-3 dark:border-wa-border-dark">
              <Dialog.Title className="text-sm font-semibold text-wa-text dark:text-wa-text-dark">{title}</Dialog.Title>
              <button type="button" onClick={onCancel} aria-label="Cerrar" className="text-wa-muted transition-colors hover:text-gray-600 dark:hover:text-gray-300">
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-3 px-4 py-4">
              <Dialog.Description className="text-xs text-wa-muted dark:text-wa-muted-dark">
                ¿Con qué paquete cerró {leadName}? Queda en la ficha, en el historial del chat y en las ventas del dashboard.
              </Dialog.Description>

              {!isLoading && sellable.length === 0 ? (
                <p role="alert" className="rounded-lg border border-dashed border-wa-border px-3 py-2 text-xs text-wa-muted dark:border-wa-border-dark dark:text-wa-muted-dark">
                  No hay paquetes para vender: carga los paquetes de tus servicios en Catálogos (o sincroniza el ERP).
                </p>
              ) : (
                <>
                  <div>
                    <label htmlFor="sale-service" className={labelClass}>Servicio</label>
                    <Select id="sale-service" value={serviceId} onValueChange={value => { setServiceId(value); setPackageId(''); setAmount(''); setError(null) }} aria-label="Servicio">
                      <option value="">Elegir servicio…</option>
                      {sellable.map(item => <option key={item.id} value={String(item.id)}>{item.name}</option>)}
                    </Select>
                  </div>
                  <div>
                    <label htmlFor="sale-package" className={labelClass}>Paquete</label>
                    <Select id="sale-package" value={packageId} onValueChange={choosePackage} disabled={!service} aria-label="Paquete">
                      <option value="">Elegir paquete…</option>
                      {service?.packages.map(item => (
                        <option key={item.id} value={String(item.id)}>
                          {`${item.name} · ${item.sessions} ${item.sessions === 1 ? 'sesión' : 'sesiones'} · ${item.price}`}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="grid grid-cols-[8rem_minmax(0,1fr)] gap-3">
                    <div>
                      <label htmlFor="sale-amount" className={labelClass}>Monto cobrado</label>
                      <Input
                        id="sale-amount"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step="0.01"
                        value={amount}
                        onChange={event => setAmount(event.target.value)}
                        placeholder={pkg ? pkg.price : '0.00'}
                        disabled={!pkg}
                      />
                      {pkg && amount.trim() !== '' && Number(amount) !== Number(pkg.price) && (
                        <p className="mt-1 text-[11px] text-wa-muted dark:text-wa-muted-dark">Lista: {pkg.price}</p>
                      )}
                    </div>
                    <div>
                      <label htmlFor="sale-notes" className={labelClass}>Notas</label>
                      <Textarea id="sale-notes" rows={2} value={notes} onChange={event => setNotes(event.target.value)} maxLength={500} placeholder="Descuento, forma de pago… (opcional)" className="resize-none" />
                    </div>
                  </div>
                </>
              )}
              {error && <p role="alert" className="text-xs text-red-700 dark:text-red-300">{error}</p>}
            </div>

            <div className="flex border-t border-wa-border dark:border-wa-border-dark">
              <Button variant="ghost" onClick={onCancel} className="h-11 flex-1 rounded-none">Cancelar</Button>
              {allowSkip && (
                <Button variant="ghost" onClick={() => onConfirm(null)} className="h-11 flex-1 rounded-none border-l border-wa-border dark:border-wa-border-dark" disabled={isPending}>
                  Mover sin registrar
                </Button>
              )}
              <Button type="submit" variant="primary" className="h-11 flex-1 rounded-none border-l border-wa-border dark:border-wa-border-dark" disabled={isPending || sellable.length === 0}>
                {confirmLabel}
              </Button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
